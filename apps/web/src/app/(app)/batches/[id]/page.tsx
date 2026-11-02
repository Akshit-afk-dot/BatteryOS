"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Layers, Plus } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { STATUS_BAR, StatusBadge } from "@/components/badges";
import { Dialog } from "@/components/overlay";
import { Button, ButtonLink, Card, CardHeader, EmptyState, Field, Input, LoadingBlock, Mono, PageHeader, Select, Table, TD, TH, THead, TR, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { BATTERY_TYPE_LABELS, CHEMISTRY_LABELS, cn, formatDate, label, ratings, STATUS_LABELS } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Batch } from "@/lib/types";

function BulkAdd({ batch, open, onOpenChange }: { batch: Batch; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { meta } = useSession();
  const qc = useQueryClient();
  const [f, setF] = useState({ count: "10", battery_type: "unknown", chemistry: "unknown", nominal_voltage_v: "", rated_capacity_ah: "", pack_configuration: "", manufacturer: "", model: "", serials: "", intake_condition: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const serialList = f.serials.trim() ? f.serials.trim().split(/\r?\n/).map((s) => s.trim()) : [];
  const count = Number(f.count);
  const mismatch = serialList.length > 0 && serialList.length !== count;
  const add = useMutation({
    mutationFn: () =>
      api<{ created: unknown[] }>("/batteries/bulk", {
        body: {
          count,
          serial_numbers: serialList.length ? serialList : null,
          template: {
            batch_id: batch.id,
            customer_id: batch.customer?.id ?? null,
            received_date: batch.received_date,
            battery_type: f.battery_type,
            chemistry: f.chemistry,
            nominal_voltage_v: f.nominal_voltage_v ? Number(f.nominal_voltage_v) : null,
            rated_capacity_ah: f.rated_capacity_ah ? Number(f.rated_capacity_ah) : null,
            pack_configuration: f.pack_configuration || null,
            manufacturer: f.manufacturer || null,
            model: f.model || null,
            intake_condition: f.intake_condition || null,
          },
        },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["batch", batch.id] });
      qc.invalidateQueries({ queryKey: ["batches"] });
      qc.invalidateQueries({ queryKey: ["batteries"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`${r.created.length} batteries registered`);
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Register several batteries"
      description={`Creates individual records in ${batch.reference}, each with its own BatteryOS ID. Shared details are recorded as entered and not verified; refine each battery later.`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" disabled={!(count >= 1 && count <= 200) || mismatch} loading={add.isPending} onClick={() => add.mutate()}>
            Register {count >= 1 ? count : ""} batteries
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="How many" htmlFor="bulk-count" hint="1 to 200">
          <Input id="bulk-count" type="number" min={1} max={200} value={f.count} onChange={set("count")} />
        </Field>
        <Field label="Type" htmlFor="bulk-type">
          <Select id="bulk-type" value={f.battery_type} onChange={set("battery_type")}>
            {meta.battery_types.map((t) => (
              <option key={t} value={t}>
                {label(BATTERY_TYPE_LABELS, t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Chemistry" htmlFor="bulk-chem">
          <Select id="bulk-chem" value={f.chemistry} onChange={set("chemistry")}>
            {meta.chemistries.map((c) => (
              <option key={c} value={c}>
                {label(CHEMISTRY_LABELS, c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nominal voltage (V)" htmlFor="bulk-v">
          <Input id="bulk-v" type="number" step="any" value={f.nominal_voltage_v} onChange={set("nominal_voltage_v")} />
        </Field>
        <Field label="Rated capacity (Ah)" htmlFor="bulk-ah">
          <Input id="bulk-ah" type="number" step="any" value={f.rated_capacity_ah} onChange={set("rated_capacity_ah")} />
        </Field>
        <Field label="Pack configuration" htmlFor="bulk-cfg">
          <Input id="bulk-cfg" value={f.pack_configuration} onChange={set("pack_configuration")} placeholder="16S1P" />
        </Field>
        <Field label="Manufacturer" htmlFor="bulk-mfr">
          <Input id="bulk-mfr" value={f.manufacturer} onChange={set("manufacturer")} />
        </Field>
        <Field label="Model" htmlFor="bulk-model" className="sm:col-span-2">
          <Input id="bulk-model" value={f.model} onChange={set("model")} />
        </Field>
        <Field
          label="Serial numbers (optional)"
          htmlFor="bulk-serials"
          className="sm:col-span-3"
          hint={mismatch ? undefined : "One per line, in order. Leave empty if you'll record them per battery."}
          error={mismatch ? `${serialList.length} serials for ${count} batteries — give one per battery or none.` : null}
        >
          <Textarea id="bulk-serials" rows={4} value={f.serials} onChange={set("serials")} className="font-mono text-[13px]" />
        </Field>
        <Field label="Shared intake note" htmlFor="bulk-cond" className="sm:col-span-3">
          <Input id="bulk-cond" value={f.intake_condition} onChange={set("intake_condition")} placeholder="e.g. Received on pallet, outer packaging intact" />
        </Field>
      </div>
    </Dialog>
  );
}

export default function BatchPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const [bulk, setBulk] = useState(false);
  const q = useQuery({ queryKey: ["batch", id], queryFn: () => api<Batch>(`/batches/${id}`) });
  const b = q.data;
  if (!b) return <LoadingBlock rows={6} />;
  const total = b.battery_count ?? 0;
  return (
    <>
      <Link href="/batches" className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-4" /> Batches
      </Link>
      <PageHeader
        eyebrow={b.customer ? b.customer.name : undefined}
        title={<Mono className="text-2xl">{b.reference}</Mono>}
        description={[b.description, b.received_date ? `Received ${formatDate(b.received_date)}` : null].filter(Boolean).join(" · ")}
        actions={
          can("batteries.write") ? (
            <>
              <ButtonLink href={`/batteries/new?batch_id=${b.id}${b.customer ? `&customer_id=${b.customer.id}` : ""}`}>
                <Plus /> Add one
              </ButtonLink>
              <Button variant="brand" onClick={() => setBulk(true)}>
                <Layers /> Register several
              </Button>
            </>
          ) : null
        }
      />
      {total ? (
        <Card className="mb-6 p-4 sm:p-5">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-zinc-100">
            {Object.entries(b.by_status ?? {}).map(([s, n]) => (
              <div key={s} className={cn("h-full", STATUS_BAR[s])} style={{ width: `${(n / total) * 100}%` }} title={`${STATUS_LABELS[s]}: ${n}`} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {Object.entries(b.by_status ?? {}).map(([s, n]) => (
              <span key={s} className="flex items-center gap-1.5 text-zinc-600">
                <span className={cn("size-2 rounded-full", STATUS_BAR[s])} />
                {label(STATUS_LABELS, s)} <span className="tabular font-medium text-zinc-900">{n}</span>
              </span>
            ))}
          </div>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={`Batteries in this batch (${total})`} />
        {!b.batteries?.length ? (
          <EmptyState title="No batteries yet" description="Register them one by one or several at once." action={can("batteries.write") ? <Button variant="brand" onClick={() => setBulk(true)}>Register several</Button> : null} />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Battery</TH>
                <TH>Status</TH>
                <TH className="hidden sm:table-cell">Serial</TH>
                <TH className="hidden md:table-cell">Specification</TH>
              </tr>
            </THead>
            <tbody>
              {b.batteries.map((x) => (
                <TR key={x.id}>
                  <TD>
                    <Link href={`/batteries/${x.id}`} className="font-mono font-semibold text-zinc-900 hover:underline">
                      {x.bos_id}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge status={x.status} />
                  </TD>
                  <TD className="hidden font-mono text-xs sm:table-cell">{x.serial_number ?? "—"}</TD>
                  <TD className="hidden md:table-cell">
                    {x.chemistry !== "unknown" ? `${x.chemistry} · ` : ""}
                    {ratings(x)}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {bulk ? <BulkAdd batch={b} open={bulk} onOpenChange={setBulk} /> : null}
    </>
  );
}
