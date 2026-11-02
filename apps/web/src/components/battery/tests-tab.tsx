"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, ClipboardCheck, FlaskConical, Gauge, MessageSquarePlus, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { KindBadge } from "@/components/badges";
import { Dialog } from "@/components/overlay";
import { Badge, Button, Callout, Card, CardHeader, EmptyState, Field, Input, LoadingBlock, Segmented, Select, Table, TD, TH, THead, TR, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { cn, formatDate, formatDateTime, formatNumber, label, NOTE_TYPE_LABELS, TEST_TYPE_LABELS, todayISO } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Battery, ChecklistEntry, Measurement, Note, TestSession, Upload } from "@/lib/types";

function useInvalidate(batteryId: string) {
  const qc = useQueryClient();
  return () => {
    for (const k of ["test-sessions", "measurements", "notes", "battery", "battery-history", "evidence"]) qc.invalidateQueries({ queryKey: [k, batteryId] });
  };
}

// ---------------------------------------------------------------- test sessions

function SessionDialog({ battery, open, onOpenChange }: { battery: Battery; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { meta, me } = useSession();
  const invalidate = useInvalidate(battery.id);
  const empty = {
    test_type: "capacity_test",
    test_date: todayISO(),
    equipment: "",
    operator_name: me.user.full_name,
    method: "",
    ambient_temp_c: "",
    charge_current_a: "",
    discharge_current_a: "",
    charge_voltage_v: "",
    cutoff_voltage_v: "",
    notes: "",
  };
  const [f, setF] = useState(empty);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => api(`/batteries/${battery.id}/test-sessions`, { body: f }),
    onSuccess: () => {
      invalidate();
      toast.success("Test session recorded");
      setF(empty);
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record a test session"
      description="Conditions make results meaningful. Record what you know; leave the rest empty."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save session
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Test" htmlFor="ts-type">
          <Select id="ts-type" value={f.test_type} onChange={set("test_type")}>
            {meta.test_types.map((t) => (
              <option key={t} value={t}>
                {label(TEST_TYPE_LABELS, t)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date" htmlFor="ts-date">
          <Input id="ts-date" type="date" value={f.test_date} onChange={set("test_date")} />
        </Field>
        <Field label="Operator" htmlFor="ts-op">
          <Input id="ts-op" value={f.operator_name} onChange={set("operator_name")} />
        </Field>
        <Field label="Equipment" htmlFor="ts-eq" className="sm:col-span-2">
          <Input id="ts-eq" value={f.equipment} onChange={set("equipment")} placeholder="Make, model, calibration reference" />
        </Field>
        <Field label="Ambient temperature (°C)" htmlFor="ts-amb">
          <Input id="ts-amb" type="number" step="any" value={f.ambient_temp_c} onChange={set("ambient_temp_c")} />
        </Field>
        <Field label="Charge current (A)" htmlFor="ts-cc">
          <Input id="ts-cc" type="number" step="any" min="0" value={f.charge_current_a} onChange={set("charge_current_a")} />
        </Field>
        <Field label="Charge to (V)" htmlFor="ts-cv">
          <Input id="ts-cv" type="number" step="any" min="0" value={f.charge_voltage_v} onChange={set("charge_voltage_v")} />
        </Field>
        <Field label="Discharge current (A)" htmlFor="ts-dc">
          <Input id="ts-dc" type="number" step="any" min="0" value={f.discharge_current_a} onChange={set("discharge_current_a")} />
        </Field>
        <Field label="Discharge cut-off (V)" htmlFor="ts-co">
          <Input id="ts-co" type="number" step="any" min="0" value={f.cutoff_voltage_v} onChange={set("cutoff_voltage_v")} />
        </Field>
        <Field label="Method / profile" htmlFor="ts-method" className="sm:col-span-3">
          <Textarea id="ts-method" rows={2} value={f.method} onChange={set("method")} placeholder="e.g. CC-CV charge to 58.4 V at 10 A, rest 1 h, CC discharge at 15 A to 44.8 V" />
        </Field>
        <Field label="Notes" htmlFor="ts-notes" className="sm:col-span-3">
          <Textarea id="ts-notes" rows={2} value={f.notes} onChange={set("notes")} />
        </Field>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- measurements

const KIND_HELP: Record<string, string> = {
  measured: "Produced by a test you ran. Link it to the test session so the conditions are on record.",
  external: "From another lab or document. Say which report it came from.",
  user_entered: "Information someone gave you, e.g. a cycle count read off a display. Not independently measured.",
  model_estimate: "Only from a named model validated for this chemistry and pack. State the model, version and validity.",
};

function MeasurementDialog({
  battery,
  sessions,
  documents,
  open,
  onOpenChange,
  defaultSession,
}: {
  battery: Battery;
  sessions: TestSession[];
  documents: Upload[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultSession?: string;
}) {
  const { meta } = useSession();
  const invalidate = useInvalidate(battery.id);
  const [f, setF] = useState({
    name: "capacity_ah",
    label: "",
    value_num: "",
    value_text: "",
    unit: meta.measurement_names.capacity_ah.unit,
    kind: "measured",
    test_session_id: defaultSession ?? sessions[0]?.id ?? "",
    conditions: "",
    source_description: "",
    source_upload_id: "",
    captured_at: "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () =>
      api(`/batteries/${battery.id}/measurements`, {
        body: {
          ...f,
          value_num: f.value_num === "" ? null : Number(f.value_num),
          test_session_id: f.test_session_id || null,
          source_upload_id: f.kind === "external" ? f.source_upload_id || null : null,
        },
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Result recorded");
      onOpenChange(false);
      setF({ ...f, value_num: "", value_text: "", conditions: "", source_description: "" });
    },
  });
  const needsSession = f.kind === "measured";
  const needsSource = f.kind === "external" || f.kind === "model_estimate";
  const invalid = (needsSession && !f.test_session_id) || (needsSource && !f.source_description.trim()) || (f.value_num === "" && !f.value_text.trim()) || (f.name === "other" && !f.label.trim());
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record a result"
      description="Results are never edited. If one is wrong, void it with a reason and record the correct value."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>
            Record result
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="What kind of value is this?">
          <Segmented
            value={f.kind}
            onChange={(kind) => setF({ ...f, kind })}
            options={[
              { value: "measured", label: "Measured" },
              { value: "external", label: "External result" },
              { value: "user_entered", label: "User-entered" },
              { value: "model_estimate", label: "Model estimate" },
            ]}
          />
          <p className="text-xs text-zinc-500">{KIND_HELP[f.kind]}</p>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Quantity" htmlFor="m-name">
            <Select
              id="m-name"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value, unit: meta.measurement_names[e.target.value]?.unit ?? "" })}
            >
              {Object.entries(meta.measurement_names).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
          {f.name === "other" ? (
            <Field label="Label" htmlFor="m-label" required>
              <Input id="m-label" value={f.label} onChange={set("label")} />
            </Field>
          ) : null}
          <Field label="Value" htmlFor="m-val" required>
            <div className="flex">
              <Input id="m-val" type="number" step="any" value={f.value_num} onChange={set("value_num")} className="rounded-r-none" />
              <Input aria-label="Unit" value={f.unit} onChange={set("unit")} className="w-20 rounded-l-none border-l-0 text-center" />
            </div>
          </Field>
          {f.name === "other" ? null : (
            <Field label="Text result (optional)" htmlFor="m-txt" hint="For pass/fail or ranges.">
              <Input id="m-txt" value={f.value_text} onChange={set("value_text")} />
            </Field>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={needsSession ? "Test session" : "Test session (optional)"} htmlFor="m-ts" required={needsSession}>
            <Select id="m-ts" value={f.test_session_id} onChange={set("test_session_id")}>
              <option value="">{sessions.length ? "None" : "No test sessions yet"}</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {label(TEST_TYPE_LABELS, s.test_type)} · {formatDate(s.test_date)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date captured" htmlFor="m-date" hint="Defaults to the test session date.">
            <Input id="m-date" type="date" value={f.captured_at} onChange={set("captured_at")} />
          </Field>
        </div>
        {needsSession && !sessions.length ? (
          <Callout tone="amber">Record the test session first so its conditions are attached to this measurement.</Callout>
        ) : null}
        <Field label="Conditions" htmlFor="m-cond" hint="e.g. 0.5C CC discharge to 44.8 V at 25 °C, after 1 h rest">
          <Input id="m-cond" value={f.conditions} onChange={set("conditions")} />
        </Field>
        {needsSource ? (
          <Field label={f.kind === "external" ? "Source (lab, report reference)" : "Model name, version and validated conditions"} htmlFor="m-src" required>
            <Textarea id="m-src" rows={2} value={f.source_description} onChange={set("source_description")} />
          </Field>
        ) : (
          <Field label="Source / remarks (optional)" htmlFor="m-src">
            <Input id="m-src" value={f.source_description} onChange={set("source_description")} />
          </Field>
        )}
        {f.kind === "external" && documents.length ? (
          <Field label="Supporting document" htmlFor="m-doc">
            <Select id="m-doc" value={f.source_upload_id} onChange={set("source_upload_id")}>
              <option value="">None</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.original_filename}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}

function VoidDialog({ m, onClose, batteryId }: { m: Measurement | null; onClose: () => void; batteryId: string }) {
  const invalidate = useInvalidate(batteryId);
  const [reason, setReason] = useState("");
  const voidIt = useMutation({
    mutationFn: () => api(`/measurements/${m!.id}/void`, { body: { reason } }),
    onSuccess: () => {
      invalidate();
      toast.success("Result voided");
      setReason("");
      onClose();
    },
  });
  return (
    <Dialog
      open={!!m}
      onOpenChange={(o) => !o && onClose()}
      title="Void this result?"
      description="It stays visible in the history, struck through, with your reason. It will no longer appear in new reports."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={reason.trim().length < 3} loading={voidIt.isPending} onClick={() => voidIt.mutate()}>
            Void result
          </Button>
        </>
      }
    >
      {m ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-700">
            {m.label}: <strong>{m.value_num !== null ? formatNumber(m.value_num, m.unit, 4) : m.value_text}</strong>
          </p>
          <Field label="Reason" htmlFor="void-reason" required>
            <Textarea id="void-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="e.g. Entered for the wrong pack" />
          </Field>
        </div>
      ) : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------- notes

function InspectionDialog({ battery, open, onOpenChange, sessions }: { battery: Battery; open: boolean; onOpenChange: (o: boolean) => void; sessions: TestSession[] }) {
  const { meta } = useSession();
  const invalidate = useInvalidate(battery.id);
  const initial = () => meta.inspection_items.map((i) => ({ item: i.key, result: "not_checked" as ChecklistEntry["result"], comment: "" }));
  const [items, setItems] = useState(initial);
  const [body, setBody] = useState("");
  const [sessionId, setSessionId] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api(`/batteries/${battery.id}/notes`, {
        body: { note_type: "inspection", body, checklist: items.map((i) => ({ ...i, comment: i.comment || null })), test_session_id: sessionId || null },
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Inspection recorded");
      setItems(initial());
      setBody("");
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Visual inspection"
      description="Record what you observed. This is an observation record, not a safety certification."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save inspection
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {items.map((it, idx) => {
          const def = meta.inspection_items.find((i) => i.key === it.item);
          return (
            <div key={it.item} className={cn("rounded-lg p-3 ring-1", it.result === "issue" ? "bg-amber-50/50 ring-amber-200" : "ring-zinc-200")}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm font-medium text-zinc-800">{def?.label}</span>
                <Segmented
                  value={it.result}
                  onChange={(result) => setItems((cur) => cur.map((x, i) => (i === idx ? { ...x, result } : x)))}
                  options={[
                    { value: "ok", label: "No issue" },
                    { value: "issue", label: "Issue" },
                    { value: "not_checked", label: "Not checked" },
                  ]}
                />
              </div>
              {it.result === "issue" ? (
                <Input
                  className="mt-2"
                  placeholder="Describe what you saw"
                  value={it.comment}
                  onChange={(e) => setItems((cur) => cur.map((x, i) => (i === idx ? { ...x, comment: e.target.value } : x)))}
                />
              ) : null}
            </div>
          );
        })}
        <Field label="Overall notes" htmlFor="insp-body">
          <Textarea id="insp-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        </Field>
        {sessions.length ? (
          <Field label="Test session (optional)" htmlFor="insp-ts">
            <Select id="insp-ts" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              <option value="">None</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {label(TEST_TYPE_LABELS, s.test_type)} · {formatDate(s.test_date)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}

function NoteComposer({ battery }: { battery: Battery }) {
  const { can } = useSession();
  const invalidate = useInvalidate(battery.id);
  const [type, setType] = useState<"observation" | "general" | "review">(can("tests.write") ? "observation" : "general");
  const [body, setBody] = useState("");
  const add = useMutation({
    mutationFn: () => api(`/batteries/${battery.id}/notes`, { body: { note_type: type, body } }),
    onSuccess: () => {
      invalidate();
      setBody("");
      toast.success("Note added");
    },
  });
  const types = can("tests.write") ? (["observation", "review", "general"] as const) : (["general"] as const);
  return (
    <div className="space-y-2 p-4 sm:p-5">
      <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add an observation, review note or general note…" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented value={type} onChange={(v) => setType(v)} options={types.map((t) => ({ value: t, label: NOTE_TYPE_LABELS[t] }))} />
        <Button variant="primary" size="sm" disabled={!body.trim()} loading={add.isPending} onClick={() => add.mutate()}>
          Add note
        </Button>
      </div>
    </div>
  );
}

function NoteItem({ note, batteryId }: { note: Note; batteryId: string }) {
  const { me, meta } = useSession();
  const invalidate = useInvalidate(batteryId);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note.body);
  const save = useMutation({
    mutationFn: () => api(`/notes/${note.id}`, { method: "PATCH", body: { body } }),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
  });
  const tone = note.note_type === "inspection" ? "emerald" : note.note_type === "review" ? "violet" : note.note_type === "observation" ? "sky" : "zinc";
  return (
    <li className="px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{label(NOTE_TYPE_LABELS, note.note_type)}</Badge>
        <span className="text-sm font-medium text-zinc-800">{note.author?.full_name}</span>
        <span className="text-xs text-zinc-400">{formatDateTime(note.created_at)}</span>
        {note.updated_at !== note.created_at && new Date(note.updated_at).getTime() - new Date(note.created_at).getTime() > 2000 ? (
          <span className="text-xs text-zinc-400">(edited)</span>
        ) : null}
        {note.author?.id === me.user.id && !editing ? (
          <button className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" onClick={() => setEditing(true)} aria-label="Edit note">
            <Pencil className="size-3.5" />
          </button>
        ) : null}
      </div>
      {note.checklist ? (
        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
          {note.checklist.map((c) => (
            <li key={c.item} className="flex items-start gap-2 text-sm">
              <span
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-full",
                  c.result === "ok" ? "bg-emerald-500" : c.result === "issue" ? "bg-amber-500" : "bg-zinc-300",
                )}
              />
              <span className={c.result === "not_checked" ? "text-zinc-400" : "text-zinc-700"}>
                {meta.inspection_items.find((i) => i.key === c.item)?.label ?? c.item}
                {c.result === "issue" ? <span className="text-amber-800"> — {c.comment || "issue noted"}</span> : c.result === "not_checked" ? " — not checked" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </Button>
          </div>
        </div>
      ) : note.body ? (
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-zinc-700">{note.body}</p>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------- tab

export function TestsTab({ battery }: { battery: Battery }) {
  const { can } = useSession();
  const sessions = useQuery({ queryKey: ["test-sessions", battery.id], queryFn: () => api<TestSession[]>(`/batteries/${battery.id}/test-sessions`) });
  const measurements = useQuery({ queryKey: ["measurements", battery.id], queryFn: () => api<Measurement[]>(`/batteries/${battery.id}/measurements`) });
  const notes = useQuery({ queryKey: ["notes", battery.id], queryFn: () => api<Note[]>(`/batteries/${battery.id}/notes`) });
  const uploads = useQuery({ queryKey: ["uploads", battery.id], queryFn: () => api<Upload[]>(`/batteries/${battery.id}/uploads`) });
  const [sessionOpen, setSessionOpen] = useState(false);
  const [measureFor, setMeasureFor] = useState<string | null | undefined>(undefined);
  const [voiding, setVoiding] = useState<Measurement | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const ms = measurements.data ?? [];
  const docs = (uploads.data ?? []).filter((u) => u.kind === "document");

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-6">
        <Card>
          <CardHeader
            icon={<Gauge />}
            title="Results"
            description="Every value shows what kind it is and where it came from."
            actions={
              can("tests.write") ? (
                <Button size="sm" variant="primary" onClick={() => setMeasureFor(null)}>
                  <Plus /> Record result
                </Button>
              ) : null
            }
          />
          {measurements.isLoading ? (
            <div className="p-4"><LoadingBlock /></div>
          ) : ms.length === 0 ? (
            <EmptyState className="py-8" title="No results recorded" description="Record capacity, internal resistance, OCV and other results with their conditions." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Quantity</TH>
                  <TH>Value</TH>
                  <TH>Kind</TH>
                  <TH className="hidden md:table-cell">Conditions / source</TH>
                  <TH className="hidden sm:table-cell">Recorded</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {ms.map((m) => (
                  <TR key={m.id} className={m.voided_at ? "bg-zinc-50/80" : undefined}>
                    <TD className={cn("font-medium text-zinc-800", m.voided_at && "text-zinc-400 line-through")}>{m.label}</TD>
                    <TD className={cn("tabular whitespace-nowrap font-semibold text-zinc-900", m.voided_at && "text-zinc-400 line-through")}>
                      {m.value_num !== null ? formatNumber(m.value_num, m.unit, 4) : m.value_text}
                    </TD>
                    <TD>{m.voided_at ? <Badge tone="rose"><Ban /> Voided</Badge> : <KindBadge kind={m.kind} />}</TD>
                    <TD className="hidden max-w-72 text-xs text-zinc-500 md:table-cell">
                      {m.voided_at ? <span className="text-rose-700">Void: {m.void_reason}</span> : [m.conditions, m.source_description].filter(Boolean).join(" · ") || "Conditions not recorded"}
                    </TD>
                    <TD className="hidden whitespace-nowrap text-xs text-zinc-500 sm:table-cell">
                      {formatDate(m.captured_at)}
                      <br />
                      {m.recorded_by?.full_name}
                    </TD>
                    <TD className="text-right">
                      {!m.voided_at && m.kind !== "calculated" && can("measurements.void") ? (
                        <Button size="sm" variant="danger-ghost" onClick={() => setVoiding(m)}>
                          Void
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader
            icon={<FlaskConical />}
            title="Test sessions"
            description="When, how and with what each test was done."
            actions={
              can("tests.write") ? (
                <Button size="sm" onClick={() => setSessionOpen(true)}>
                  <Plus /> New session
                </Button>
              ) : null
            }
          />
          {sessions.isLoading ? (
            <div className="p-4"><LoadingBlock /></div>
          ) : !sessions.data?.length ? (
            <EmptyState className="py-8" title="No test sessions" description="Create one before recording measured results." />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {sessions.data.map((s) => {
                const linked = ms.filter((m) => m.test_session_id === s.id && !m.voided_at);
                const cond = [
                  s.ambient_temp_c !== null ? `ambient ${formatNumber(s.ambient_temp_c, "°C")}` : null,
                  s.charge_current_a !== null ? `charge ${formatNumber(s.charge_current_a, "A")}` : null,
                  s.charge_voltage_v !== null ? `to ${formatNumber(s.charge_voltage_v, "V")}` : null,
                  s.discharge_current_a !== null ? `discharge ${formatNumber(s.discharge_current_a, "A")}` : null,
                  s.cutoff_voltage_v !== null ? `cut-off ${formatNumber(s.cutoff_voltage_v, "V")}` : null,
                ].filter(Boolean);
                return (
                  <li key={s.id} className="px-4 py-3.5 sm:px-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-900">{label(TEST_TYPE_LABELS, s.test_type)}</span>
                      <span className="text-xs text-zinc-500">{formatDate(s.test_date)}</span>
                      {s.operator_name ? <span className="text-xs text-zinc-500">· {s.operator_name}</span> : null}
                      {can("tests.write") ? (
                        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setMeasureFor(s.id)}>
                          <Plus /> Result
                        </Button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {s.equipment ? `${s.equipment} · ` : ""}
                      {cond.length ? cond.join(", ") : "Conditions not recorded"}
                    </p>
                    {s.method ? <p className="mt-1 text-sm text-zinc-700">{s.method}</p> : null}
                    {linked.length ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {linked.map((m) => (
                          <Badge key={m.id} tone="sky">
                            {m.label}: {m.value_num !== null ? formatNumber(m.value_num, m.unit, 4) : m.value_text}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card className="self-start">
        <CardHeader
          icon={<MessageSquarePlus />}
          title="Technician notes"
          actions={
            can("tests.write") ? (
              <Button size="sm" onClick={() => setInspecting(true)}>
                <ClipboardCheck /> Inspection
              </Button>
            ) : null
          }
        />
        {can("notes.write") ? <NoteComposer battery={battery} /> : null}
        {notes.isLoading ? (
          <div className="p-4"><LoadingBlock /></div>
        ) : notes.data?.length ? (
          <ul className="divide-y divide-zinc-100 border-t border-zinc-100">
            {notes.data.map((n) => (
              <NoteItem key={n.id} note={n} batteryId={battery.id} />
            ))}
          </ul>
        ) : (
          <EmptyState className="border-t border-zinc-100 py-8" title="No notes yet" />
        )}
      </Card>

      <SessionDialog battery={battery} open={sessionOpen} onOpenChange={setSessionOpen} />
      {measureFor !== undefined ? (
        <MeasurementDialog
          battery={battery}
          sessions={sessions.data ?? []}
          documents={docs}
          open
          onOpenChange={(o) => !o && setMeasureFor(undefined)}
          defaultSession={measureFor ?? undefined}
        />
      ) : null}
      <VoidDialog m={voiding} onClose={() => setVoiding(null)} batteryId={battery.id} />
      <InspectionDialog battery={battery} open={inspecting} onOpenChange={setInspecting} sessions={sessions.data ?? []} />
    </div>
  );
}
