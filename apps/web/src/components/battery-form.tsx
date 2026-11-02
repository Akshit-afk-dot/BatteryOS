"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";

import { BatchPicker, CustomerPicker } from "@/components/pickers";
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { BATTERY_TYPE_LABELS, CHEMISTRY_LABELS, cn, label, PROVENANCE_LABELS, todayISO } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Battery } from "@/lib/types";

export interface BatteryValues {
  customer_id: string | null;
  batch_id: string | null;
  received_date: string;
  battery_type: string;
  chemistry: string;
  nominal_voltage_v: string;
  rated_capacity_ah: string;
  pack_configuration: string;
  manufacturer: string;
  model: string;
  serial_number: string;
  bms_info: string;
  intake_condition: string;
  notes: string;
  warranty_expires_on: string;
  provenance: Record<string, string>;
}

export function emptyBattery(): BatteryValues {
  return {
    customer_id: null,
    batch_id: null,
    received_date: todayISO(),
    battery_type: "unknown",
    chemistry: "unknown",
    nominal_voltage_v: "",
    rated_capacity_ah: "",
    pack_configuration: "",
    manufacturer: "",
    model: "",
    serial_number: "",
    bms_info: "",
    intake_condition: "",
    notes: "",
    warranty_expires_on: "",
    provenance: {},
  };
}

export function fromBattery(b: Battery): BatteryValues {
  const prov: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.provenance ?? {})) if (v !== "unknown") prov[k] = v;
  return {
    customer_id: b.customer?.id ?? null,
    batch_id: b.batch?.id ?? null,
    received_date: b.received_date ?? "",
    battery_type: b.battery_type,
    chemistry: b.chemistry,
    nominal_voltage_v: b.nominal_voltage_v?.toString() ?? "",
    rated_capacity_ah: b.rated_capacity_ah?.toString() ?? "",
    pack_configuration: b.pack_configuration ?? "",
    manufacturer: b.manufacturer ?? "",
    model: b.model ?? "",
    serial_number: b.serial_number ?? "",
    bms_info: b.bms_info ?? "",
    intake_condition: b.intake_condition ?? "",
    notes: b.notes ?? "",
    warranty_expires_on: b.warranty_expires_on ?? "",
    provenance: prov,
  };
}

const num = (s: string) => (s.trim() === "" ? null : Number(s));
const str = (s: string) => (s.trim() === "" ? null : s.trim());

export function toPayload(v: BatteryValues) {
  return {
    customer_id: v.customer_id,
    batch_id: v.batch_id,
    received_date: v.received_date || null,
    battery_type: v.battery_type,
    chemistry: v.chemistry,
    nominal_voltage_v: num(v.nominal_voltage_v),
    rated_capacity_ah: num(v.rated_capacity_ah),
    pack_configuration: str(v.pack_configuration),
    manufacturer: str(v.manufacturer),
    model: str(v.model),
    serial_number: str(v.serial_number),
    bms_info: str(v.bms_info),
    intake_condition: str(v.intake_condition),
    notes: str(v.notes),
    warranty_expires_on: v.warranty_expires_on || null,
    provenance: v.provenance,
  };
}

function SourceSelect({ field, values, setValues, disabled }: { field: string; values: BatteryValues; setValues: (v: BatteryValues) => void; disabled?: boolean }) {
  const { meta } = useSession();
  return (
    <select
      aria-label="Where this value came from"
      disabled={disabled}
      value={values.provenance[field] ?? "unverified"}
      onChange={(e) => setValues({ ...values, provenance: { ...values.provenance, [field]: e.target.value } })}
      className="h-6 rounded-md border-0 bg-zinc-100 py-0 pl-1.5 pr-1 text-[11px] font-medium text-zinc-600 focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:opacity-40"
    >
      {meta.provenance_sources.map((s) => (
        <option key={s} value={s}>
          {label(PROVENANCE_LABELS, s)}
        </option>
      ))}
    </select>
  );
}

export function BatteryForm({
  values,
  setValues,
  suggested,
  onSubmit,
  submitting,
  submitLabel,
  onCancel,
  showWarranty,
}: {
  values: BatteryValues;
  setValues: (v: BatteryValues) => void;
  suggested?: Set<string>;
  onSubmit: () => void;
  submitting?: boolean;
  submitLabel: string;
  onCancel?: () => void;
  showWarranty?: boolean;
}) {
  const { meta } = useSession();
  const set = (k: keyof BatteryValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setValues({ ...values, [k]: e.target.value });
  const hl = (k: string) => (suggested?.has(k) ? "ring-2 ring-fuchsia-300 bg-fuchsia-50/40" : undefined);
  const sugg = (k: string) =>
    suggested?.has(k) ? (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-fuchsia-700">
        <Sparkles className="size-3" /> Suggested — check
      </span>
    ) : null;

  const withSource = (field: keyof BatteryValues & string, title: string, input: React.ReactNode) => {
    const empty = !String(values[field] ?? "").trim() || values[field] === "unknown";
    return (
      <Field label={title} htmlFor={field}>
        {input}
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-zinc-500">
          {empty ? "Recorded as unknown" : "Source"}
          {empty ? null : <SourceSelect field={field} values={values} setValues={setValues} />}
          {sugg(field)}
        </span>
      </Field>
    );
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-5"
    >
      <Card>
        <CardHeader title="Customer and intake" description="Who the battery came from and when." />
        <div className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
          <Field label="Customer / supplier" htmlFor="customer">
            <CustomerPicker id="customer" value={values.customer_id} onChange={(id) => setValues({ ...values, customer_id: id })} />
          </Field>
          <Field label="Batch" htmlFor="batch" hint="Optional grouping for a consignment.">
            <BatchPicker id="batch" value={values.batch_id} customerId={values.customer_id} onChange={(id) => setValues({ ...values, batch_id: id })} />
          </Field>
          <Field label="Received on" htmlFor="received_date">
            <Input id="received_date" type="date" value={values.received_date} onChange={set("received_date")} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Specification"
          description="Leave anything you don't know empty — it is recorded as unknown. Use the source tag to say where each value came from."
        />
        <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
          <Field label="Battery type" htmlFor="battery_type">
            <Select id="battery_type" value={values.battery_type} onChange={set("battery_type")} className={hl("battery_type")}>
              {meta.battery_types.map((t) => (
                <option key={t} value={t}>
                  {label(BATTERY_TYPE_LABELS, t)}
                </option>
              ))}
            </Select>
            {sugg("battery_type")}
          </Field>
          {withSource(
            "chemistry",
            "Chemistry",
            <Select id="chemistry" value={values.chemistry} onChange={set("chemistry")} className={hl("chemistry")}>
              {meta.chemistries.map((c) => (
                <option key={c} value={c}>
                  {label(CHEMISTRY_LABELS, c)}
                </option>
              ))}
            </Select>,
          )}
          {withSource(
            "pack_configuration",
            "Pack configuration",
            <Input id="pack_configuration" value={values.pack_configuration} onChange={set("pack_configuration")} placeholder="e.g. 16S2P" className={hl("pack_configuration")} />,
          )}
          {withSource(
            "nominal_voltage_v",
            "Nominal voltage (V)",
            <Input id="nominal_voltage_v" type="number" step="any" min="0" value={values.nominal_voltage_v} onChange={set("nominal_voltage_v")} placeholder="e.g. 51.2" className={hl("nominal_voltage_v")} />,
          )}
          {withSource(
            "rated_capacity_ah",
            "Rated capacity (Ah)",
            <Input id="rated_capacity_ah" type="number" step="any" min="0" value={values.rated_capacity_ah} onChange={set("rated_capacity_ah")} placeholder="e.g. 100" className={hl("rated_capacity_ah")} />,
          )}
          {withSource(
            "bms_info",
            "BMS",
            <Input id="bms_info" value={values.bms_info} onChange={set("bms_info")} placeholder="Make / model / firmware" className={hl("bms_info")} />,
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Identification" />
        <div className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
          {withSource("manufacturer", "Manufacturer", <Input id="manufacturer" value={values.manufacturer} onChange={set("manufacturer")} className={hl("manufacturer")} />)}
          {withSource("model", "Model", <Input id="model" value={values.model} onChange={set("model")} className={hl("model")} />)}
          {withSource(
            "serial_number",
            "Serial number",
            <Input id="serial_number" value={values.serial_number} onChange={set("serial_number")} className={cn("font-mono", hl("serial_number"))} />,
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Condition and notes" />
        <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2">
          <Field label="Condition at intake" htmlFor="intake_condition" hint="What you can see on arrival. Not a safety assessment.">
            <Textarea id="intake_condition" rows={3} value={values.intake_condition} onChange={set("intake_condition")} placeholder="e.g. Casing scuffed, terminals clean, BMS beeping" />
          </Field>
          <Field label="Notes" htmlFor="notes">
            <Textarea id="notes" rows={3} value={values.notes} onChange={set("notes")} placeholder="Customer complaint, history, anything else" />
          </Field>
          {showWarranty ? (
            <Field label="Warranty expires on" htmlFor="warranty" hint="For refurbished or repaired batteries you have dispatched.">
              <Input id="warranty" type="date" value={values.warranty_expires_on} onChange={set("warranty_expires_on")} />
            </Field>
          ) : null}
        </div>
      </Card>

      <div className="flex items-center justify-end gap-2">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" variant="brand" size="lg" loading={submitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function useBatteryValues(initial: BatteryValues) {
  return useState<BatteryValues>(initial);
}
