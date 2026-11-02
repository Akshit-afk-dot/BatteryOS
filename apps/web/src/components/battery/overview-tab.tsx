"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, ClipboardList, Pencil, Plus, ShieldCheck, Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BatteryForm, fromBattery, toPayload, type BatteryValues } from "@/components/battery-form";
import { ProvenanceBadge } from "@/components/badges";
import { Dialog } from "@/components/overlay";
import { Button, Card, CardHeader, EmptyState, Field, Input, KV, Mono, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import {
  BATTERY_TYPE_LABELS,
  CHEMISTRY_LABELS,
  cn,
  formatDate,
  formatNumber,
  label,
  SERVICE_EVENT_LABELS,
  todayISO,
} from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Battery, ServiceEvent } from "@/lib/types";

const TAB_FOR: Record<string, string> = {
  photos: "files",
  data: "files",
  inspection: "tests",
  capacity: "tests",
  resistance: "tests",
};

function EditBattery({ battery, open, onOpenChange }: { battery: Battery; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [values, setValues] = useState<BatteryValues>(() => fromBattery(battery));
  const save = useMutation({
    mutationFn: () => api<Battery>(`/batteries/${battery.id}`, { method: "PATCH", body: toPayload(values) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["battery", battery.id] });
      qc.invalidateQueries({ queryKey: ["battery-history", battery.id] });
      qc.invalidateQueries({ queryKey: ["batteries"] });
      toast.success("Battery details saved");
      onOpenChange(false);
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Edit ${battery.bos_id}`} description="Changes are recorded in the battery's history with before and after values." size="xl">
      <BatteryForm
        values={values}
        setValues={setValues}
        onSubmit={() => save.mutate()}
        submitting={save.isPending}
        submitLabel="Save changes"
        onCancel={() => onOpenChange(false)}
        showWarranty
      />
    </Dialog>
  );
}

function ServiceEvents({ battery }: { battery: Battery }) {
  const { meta, can } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ event_type: "repair", description: "", performed_by_name: "", performed_on: todayISO() });
  const events = useQuery({
    queryKey: ["service-events", battery.id],
    queryFn: () => api<ServiceEvent[]>(`/batteries/${battery.id}/service-events`),
  });
  const add = useMutation({
    mutationFn: () => api(`/batteries/${battery.id}/service-events`, { body: form }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-events", battery.id] });
      qc.invalidateQueries({ queryKey: ["battery", battery.id] });
      qc.invalidateQueries({ queryKey: ["battery-history", battery.id] });
      setOpen(false);
      setForm({ ...form, description: "" });
      toast.success("Service event recorded");
    },
  });
  return (
    <Card>
      <CardHeader
        icon={<Wrench />}
        title="Service and warranty"
        description={battery.warranty_expires_on ? `Warranty recorded until ${formatDate(battery.warranty_expires_on)}` : "Repairs, replacements, dispatch and warranty claims."}
        actions={
          can("batteries.write") ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus /> Add event
            </Button>
          ) : null
        }
      />
      {events.data?.length ? (
        <ol className="divide-y divide-zinc-100">
          {events.data.map((e) => (
            <li key={e.id} className="flex gap-3 px-4 py-3 sm:px-5">
              <div className="w-24 shrink-0 text-xs text-zinc-500">{formatDate(e.performed_on)}</div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-900">{label(SERVICE_EVENT_LABELS, e.event_type)}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm text-zinc-600">{e.description}</p>
                <p className="mt-1 text-xs text-zinc-400">
                  {e.performed_by_name ? `By ${e.performed_by_name} · ` : ""}recorded by {e.created_by?.full_name}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState className="py-8" title="No service events yet" description="Record repairs, replacements, dispatch and warranty claims as they happen." />
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Record a service event"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={add.isPending} disabled={!form.description.trim()} onClick={() => add.mutate()}>
              Save event
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Event" htmlFor="se-type">
            <Select id="se-type" value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}>
              {meta.service_event_types.map((t) => (
                <option key={t} value={t}>
                  {label(SERVICE_EVENT_LABELS, t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date" htmlFor="se-date">
            <Input id="se-date" type="date" value={form.performed_on} onChange={(e) => setForm({ ...form, performed_on: e.target.value })} />
          </Field>
          <Field label="What was done" htmlFor="se-desc" className="sm:col-span-2" required>
            <Textarea id="se-desc" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} autoFocus />
          </Field>
          <Field label="Performed by" htmlFor="se-by" className="sm:col-span-2">
            <Input id="se-by" value={form.performed_by_name} onChange={(e) => setForm({ ...form, performed_by_name: e.target.value })} placeholder="Technician or vendor" />
          </Field>
        </div>
      </Dialog>
    </Card>
  );
}

export function OverviewTab({ battery: b, onNavigate }: { battery: Battery; onNavigate: (tab: string) => void }) {
  const { can } = useSession();
  const [editing, setEditing] = useState(false);
  const prov = b.provenance ?? {};
  const completeness = b.completeness ?? [];
  const done = completeness.filter((c) => c.done).length;
  const pct = completeness.length ? Math.round((done / completeness.length) * 100) : 0;

  const row = (field: string, title: string, value: React.ReactNode) => ({
    label: title,
    value,
    aside: <ProvenanceBadge source={prov[field] ?? "unknown"} />,
  });
  const unknown = <span className="text-zinc-400">Unknown</span>;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Specification and identification"
            description="Each value shows where it came from. Unknown values are shown as unknown, not guessed."
            actions={
              can("batteries.write") ? (
                <Button size="sm" onClick={() => setEditing(true)}>
                  <Pencil /> Edit
                </Button>
              ) : null
            }
          />
          <div className="px-4 sm:px-5">
            <KV
              items={[
                { label: "Battery type", value: label(BATTERY_TYPE_LABELS, b.battery_type) },
                row("chemistry", "Chemistry", b.chemistry !== "unknown" ? label(CHEMISTRY_LABELS, b.chemistry) : unknown),
                row("nominal_voltage_v", "Nominal voltage", b.nominal_voltage_v ? formatNumber(b.nominal_voltage_v, "V") : unknown),
                row("rated_capacity_ah", "Rated capacity", b.rated_capacity_ah ? formatNumber(b.rated_capacity_ah, "Ah") : unknown),
                row("pack_configuration", "Pack configuration", b.pack_configuration ? <Mono>{b.pack_configuration}</Mono> : unknown),
                row("manufacturer", "Manufacturer", b.manufacturer ?? unknown),
                row("model", "Model", b.model ?? unknown),
                row("serial_number", "Serial number", b.serial_number ? <Mono>{b.serial_number}</Mono> : unknown),
                row("bms_info", "BMS", b.bms_info ?? unknown),
              ]}
            />
          </div>
        </Card>

        <Card>
          <CardHeader icon={<ClipboardList />} title="Condition at intake and notes" />
          <div className="grid gap-4 p-4 text-sm sm:grid-cols-2 sm:p-5">
            <div>
              <p className="text-xs font-medium text-zinc-500">Condition at intake</p>
              <p className="mt-1 whitespace-pre-wrap text-zinc-800">{b.intake_condition || <span className="text-zinc-400">Not recorded</span>}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-zinc-500">Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-zinc-800">{b.notes || <span className="text-zinc-400">None</span>}</p>
            </div>
          </div>
        </Card>

        <ServiceEvents battery={b} />
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader icon={<ShieldCheck />} title="Record completeness" description="What is on record so far — not a quality score." />
          <div className="p-4 sm:p-5">
            <div className="flex items-baseline justify-between">
              <span className="tabular text-2xl font-semibold text-zinc-900">
                {done}
                <span className="text-base font-normal text-zinc-400"> / {completeness.length}</span>
              </span>
              <span className="text-xs text-zinc-500">items recorded</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100">
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <ul className="mt-4 space-y-2.5">
              {completeness.map((c) => (
                <li key={c.key} className="flex gap-2.5">
                  {c.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-600" /> : <Circle className="mt-0.5 size-4 shrink-0 text-zinc-300" />}
                  <div className="min-w-0">
                    <p className={cn("text-sm", c.done ? "text-zinc-500" : "text-zinc-900")}>{c.label}</p>
                    {!c.done ? (
                      <p className="text-xs text-zinc-500">
                        {c.hint}{" "}
                        {TAB_FOR[c.key] ? (
                          <button className="font-medium text-brand-700 hover:underline" onClick={() => onNavigate(TAB_FOR[c.key])}>
                            Go
                          </button>
                        ) : can("batteries.write") ? (
                          <button className="font-medium text-brand-700 hover:underline" onClick={() => setEditing(true)}>
                            Edit
                          </button>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card>
          <CardHeader title="On record" />
          <div className="grid grid-cols-2 gap-px bg-zinc-100">
            {[
              ["Files", b.counts?.uploads, "files"],
              ["Imported datasets", b.counts?.datasets, "diagnostics"],
              ["Test sessions", b.counts?.test_sessions, "tests"],
              ["Measurements", b.counts?.measurements, "tests"],
              ["Notes", b.counts?.notes, "tests"],
              ["Reports", b.counts?.reports, "reports"],
            ].map(([t, n, tab]) => (
              <button key={t as string} onClick={() => onNavigate(tab as string)} className="bg-white px-4 py-3 text-left hover:bg-zinc-50">
                <p className="tabular text-lg font-semibold text-zinc-900">{(n as number) ?? 0}</p>
                <p className="text-xs text-zinc-500">{t}</p>
              </button>
            ))}
          </div>
        </Card>
      </div>
      {editing ? <EditBattery battery={b} open={editing} onOpenChange={setEditing} /> : null}
    </div>
  );
}
