"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Plus, Receipt, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { QuoteStatusBadge } from "@/components/badges";
import { Dialog } from "@/components/overlay";
import { Button, Callout, Card, CardHeader, EmptyState, Field, LoadingBlock, Mono, Select, Switch } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatINR } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Battery, Quotation, Report } from "@/lib/types";

export function NewQuotationDialog({ battery, open, onOpenChange }: { battery: Battery; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { me } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const reports = useQuery({ queryKey: ["reports", battery.id], queryFn: () => api<Report[]>(`/batteries/${battery.id}/reports`), enabled: open });
  const approved = (reports.data ?? []).filter((r) => r.status === "approved");
  const [reportId, setReportId] = useState<string>("");
  const [useAi, setUseAi] = useState(true);
  const chosen = reportId || approved[0]?.id || "";
  const aiPossible = me.ai.configured && !!chosen;
  const create = useMutation({
    mutationFn: () => api<Quotation>("/quotations", { body: { battery_id: battery.id, report_id: chosen || null, use_ai: aiPossible && useAi } }),
    onSuccess: (q) => {
      qc.invalidateQueries({ queryKey: ["quotations"] });
      qc.invalidateQueries({ queryKey: ["battery", battery.id] });
      if (q.draft_notes && q.drafted_by === "template") toast.warning(q.draft_notes);
      else toast.success(`${q.number} drafted`);
      router.push(`/quotations/${q.id}`);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New quotation"
      description={`For ${battery.bos_id}${battery.customer ? ` · ${battery.customer.name}` : ""}. Prices always come from your service catalogue.`}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
            {aiPossible && useAi ? <Sparkles /> : null}
            Create draft
          </Button>
        </>
      }
    >
      {reports.isLoading ? (
        <LoadingBlock rows={3} />
      ) : (
        <div className="space-y-4">
          <Field label="Based on report" htmlFor="q-report" hint="Quotations should follow the approved findings.">
            <Select id="q-report" value={chosen} onChange={(e) => setReportId(e.target.value)}>
              <option value="">No report (start from catalogue defaults)</option>
              {approved.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.report_number} v{r.version} · approved {formatDate(r.approved_at)}
                </option>
              ))}
            </Select>
          </Field>
          {approved.length === 0 ? (
            <Callout tone="amber">No approved report yet. You can still start a quotation from your catalogue defaults and add lines by hand.</Callout>
          ) : null}
          <div className="flex items-start justify-between gap-4 rounded-lg bg-zinc-50 p-3 ring-1 ring-zinc-200">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-900">
                <Sparkles className="size-4 text-fuchsia-600" /> Suggest lines with AI
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {!me.ai.configured
                  ? "AI is not configured on this server."
                  : !chosen
                    ? "Needs an approved report to draft from."
                    : "Chooses catalogue items and quantities from the approved findings and explains each. It never sets prices, and nothing is sent or approved automatically."}
              </p>
            </div>
            <Switch checked={aiPossible && useAi} onChange={setUseAi} disabled={!aiPossible} />
          </div>
        </div>
      )}
    </Dialog>
  );
}

export function QuotationsTab({ battery }: { battery: Battery }) {
  const { can } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const quotes = useQuery({ queryKey: ["quotations", { battery: battery.id }], queryFn: () => api<Quotation[]>("/quotations", { params: { battery_id: battery.id } }) });
  const [open, setOpen] = useState(params.get("new") === "1");
  const close = (o: boolean) => {
    setOpen(o);
    if (!o && params.get("new")) {
      const next = new URLSearchParams(params.toString());
      next.delete("new");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }
  };
  return (
    <>
      <Card>
        <CardHeader
          icon={<Receipt />}
          title="Quotations"
          description="Drafted from your catalogue and the approved findings. An authorised person approves before anything goes to the customer."
          actions={
            can("quotations.draft") ? (
              <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
                <Plus /> New quotation
              </Button>
            ) : null
          }
        />
        {quotes.isLoading ? (
          <div className="p-4"><LoadingBlock /></div>
        ) : !quotes.data?.length ? (
          <EmptyState icon={<Receipt />} title="No quotations yet" action={can("quotations.draft") ? <Button variant="primary" onClick={() => setOpen(true)}>New quotation</Button> : null} />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {quotes.data.map((q) => (
              <li key={q.id}>
                <Link href={`/quotations/${q.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Mono className="font-semibold text-zinc-900">{q.number}</Mono>
                      <span className="text-xs text-zinc-400">rev {q.revision}</span>
                      <QuoteStatusBadge status={q.status} />
                    </div>
                    <p className="mt-0.5 text-xs text-zinc-500">
                      {q.customer?.name ?? "No customer"} · valid until {formatDate(q.valid_until)}
                    </p>
                  </div>
                  <span className="tabular text-sm font-semibold text-zinc-900">{formatINR(q.total_paise)}</span>
                  <ChevronRight className="size-4 text-zinc-300" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open ? <NewQuotationDialog battery={battery} open={open} onOpenChange={close} /> : null}
    </>
  );
}
