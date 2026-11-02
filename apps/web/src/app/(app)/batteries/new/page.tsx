"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ScanText, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";

import { BatteryForm, emptyBattery, toPayload, type BatteryValues } from "@/components/battery-form";
import { Button, Callout, Card, CardHeader, PageHeader, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { BATTERY_TYPE_LABELS, FIELD_LABELS, label } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Battery, Customer } from "@/lib/types";

interface Extracted {
  source: "ai" | "pattern";
  fields: { field: string; value: string | number; quote: string }[];
  notice?: string;
}

const EXTRACT_LABELS: Record<string, string> = { ...FIELD_LABELS, battery_type: "Battery type", customer_name: "Customer" };

function IntakeAssist({ values, setValues, onApplied }: { values: BatteryValues; setValues: (v: BatteryValues) => void; onApplied: (fields: string[]) => void }) {
  const { me } = useSession();
  const [text, setText] = useState("");
  const [result, setResult] = useState<Extracted | null>(null);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const extract = useMutation({
    mutationFn: () => api<Extracted>("/assistant/extract-intake", { body: { text } }),
    onSuccess: (r) => {
      setResult(r);
      setApplied(new Set());
    },
  });
  const customers = useQueryClient().getQueryData<Customer[]>(["customers"]);

  const applyOne = (f: Extracted["fields"][number], acc: BatteryValues): BatteryValues => {
    if (f.field === "customer_name") {
      const match = customers?.find((c) => c.name.toLowerCase() === String(f.value).toLowerCase());
      return match ? { ...acc, customer_id: match.id } : acc;
    }
    const value = String(f.value);
    // Extracted from free text: record as unverified until someone checks the pack.
    const provenance = f.field === "battery_type" ? acc.provenance : { ...acc.provenance, [f.field]: "unverified" };
    return { ...acc, [f.field]: value, provenance };
  };
  const apply = (fields: Extracted["fields"]) => {
    let next = values;
    for (const f of fields) next = applyOne(f, next);
    setValues(next);
    const keys = fields.map((f) => (f.field === "customer_name" ? "customer_id" : f.field));
    setApplied((s) => new Set([...s, ...fields.map((f) => f.field)]));
    onApplied(keys);
  };

  return (
    <Card className="lg:sticky lg:top-20">
      <CardHeader
        icon={<ScanText />}
        title="Fill from text"
        description="Paste a customer message, delivery note or label transcription. Nothing is applied until you choose."
      />
      <div className="space-y-3 p-4">
        <Textarea
          rows={6}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"e.g. Sharma E-Rickshaw sent a 51.2V 105Ah LiFePO4 pack, 16S1P, S/N SR-2291-A. BMS keeps beeping."}
        />
        <Button variant="secondary" className="w-full" disabled={text.trim().length < 3} loading={extract.isPending} onClick={() => extract.mutate()}>
          <Sparkles className="!text-fuchsia-600" />
          {me.ai.configured ? "Extract details" : "Extract details (pattern matching)"}
        </Button>
        {result ? (
          <div className="space-y-2">
            {result.notice ? <Callout tone="amber">{result.notice}</Callout> : null}
            <p className="text-xs text-zinc-500">
              {result.fields.length
                ? `Found ${result.fields.length} detail${result.fields.length === 1 ? "" : "s"} ${result.source === "ai" ? "with AI" : "by pattern matching"}. Each one is quoted from your text.`
                : "No details could be found in this text."}
            </p>
            {result.fields.map((f) => (
              <div key={f.field} className="flex items-start gap-2 rounded-lg bg-zinc-50 p-2.5 ring-1 ring-zinc-200">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-zinc-500">{EXTRACT_LABELS[f.field] ?? f.field}</p>
                  <p className="text-sm font-medium text-zinc-900">{f.field === "battery_type" ? label(BATTERY_TYPE_LABELS, String(f.value)) : String(f.value)}</p>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-400">“{f.quote}”</p>
                </div>
                {applied.has(f.field) ? (
                  <Check className="mt-1 size-4 text-brand-600" />
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => apply([f])}>
                    Use
                  </Button>
                )}
              </div>
            ))}
            {result.fields.length > 1 ? (
              <Button size="sm" variant="primary" className="w-full" onClick={() => apply(result.fields.filter((f) => !applied.has(f.field)))}>
                Use all
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function NewBatteryInner() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [values, setValues] = useState<BatteryValues>(() => ({
    ...emptyBattery(),
    batch_id: params.get("batch_id"),
    customer_id: params.get("customer_id"),
  }));
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
  const create = useMutation({
    mutationFn: () => api<Battery>("/batteries", { body: toPayload(values) }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["batteries"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`${b.bos_id} registered`);
      router.push(`/batteries/${b.id}`);
    },
  });
  return (
    <>
      <Link href="/batteries" className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-4" /> Batteries
      </Link>
      <PageHeader
        title="New intake"
        description="Register a battery and give it a BatteryOS ID. Capture what you know now — tests, files and notes come next."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <BatteryForm
          values={values}
          setValues={(v) => {
            // Editing a suggested field clears its highlight.
            const changed = Object.keys(v).filter((k) => (v as any)[k] !== (values as any)[k]);
            if (changed.length && suggested.size) setSuggested(new Set([...suggested].filter((k) => !changed.includes(k))));
            setValues(v);
          }}
          suggested={suggested}
          onSubmit={() => create.mutate()}
          submitting={create.isPending}
          submitLabel="Register battery"
          onCancel={() => router.push("/batteries")}
        />
        <div>
          <IntakeAssist values={values} setValues={setValues} onApplied={(keys) => setSuggested(new Set([...suggested, ...keys]))} />
        </div>
      </div>
    </>
  );
}

export default function NewBatteryPage() {
  return (
    <Suspense>
      <NewBatteryInner />
    </Suspense>
  );
}
