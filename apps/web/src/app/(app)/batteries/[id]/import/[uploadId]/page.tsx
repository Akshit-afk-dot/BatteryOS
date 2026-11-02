"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  Fingerprint,
  Info,
  Loader2,
  Settings2,
  TableProperties,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge, Button, Callout, Card, CardHeader, Checkbox, Field, Input, LoadingBlock, Mono, Select } from "@/components/ui";
import { api, ApiError, errorMessage } from "@/lib/api";
import { cn, formatBytes, formatDateTime, formatNumber, label, TEST_TYPE_LABELS } from "@/lib/format";
import type { Battery, Dataset, Issue, MappingEntry, ParserOptions, Preview, TestSession } from "@/lib/types";

const CANON_UNITS: Record<string, string> = {
  t_s: "s",
  voltage_v: "V",
  current_a: "A",
  temperature_c: "°C",
  soc_pct: "%",
  capacity_ah: "Ah",
  energy_wh: "Wh",
  power_w: "W",
};

function IssueList({ issues }: { issues: Issue[] }) {
  const groups = [
    { sev: "error" as const, title: "Errors — must be fixed before import", icon: <AlertCircle className="size-4 text-rose-600" />, cls: "bg-rose-50/60 ring-rose-200" },
    { sev: "warning" as const, title: "Warnings — review before importing", icon: <AlertTriangle className="size-4 text-amber-600" />, cls: "bg-amber-50/50 ring-amber-200" },
    { sev: "info" as const, title: "For information", icon: <Info className="size-4 text-sky-600" />, cls: "bg-sky-50/40 ring-sky-200" },
  ];
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const items = issues.filter((i) => i.severity === g.sev);
        if (!items.length) return null;
        return (
          <div key={g.sev}>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {g.icon} {g.title} ({items.length})
            </p>
            <ul className="space-y-2">
              {items.map((i, n) => (
                <li key={n} className={cn("rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset", g.cls)}>
                  <p className="text-zinc-800">{i.message}</p>
                  {i.rows?.length || i.column ? (
                    <p className="mt-1 text-xs text-zinc-500">
                      {i.column ? (
                        <>
                          Column <Mono>{i.column}</Mono>
                        </>
                      ) : null}
                      {i.column && i.rows?.length ? " · " : null}
                      {i.rows?.length ? `File line${i.rows.length > 1 ? "s" : ""} ${i.rows.join(", ")}${(i.count ?? 0) > i.rows.length ? "…" : ""}` : null}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {!issues.length ? (
        <Callout tone="emerald" icon={<CheckCircle2 />}>
          No problems found.
        </Callout>
      ) : null}
    </div>
  );
}

function UnitSource({ m, onConfirm }: { m: MappingEntry; onConfirm: () => void }) {
  if (m.unit_source === "assumed")
    return (
      <button onClick={onConfirm} className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200 hover:bg-amber-200">
        Assumed — confirm
      </button>
    );
  if (m.unit_source === "header") return <Badge tone="zinc">From header</Badge>;
  return <Badge tone="emerald">Set by you</Badge>;
}

export default function ImportPage() {
  const { id, uploadId } = useParams<{ id: string; uploadId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const battery = useQuery({ queryKey: ["battery", id], queryFn: () => api<Battery>(`/batteries/${id}`) });
  const sessions = useQuery({ queryKey: ["test-sessions", id], queryFn: () => api<TestSession[]>(`/batteries/${id}/test-sessions`) });

  const [options, setOptions] = useState<ParserOptions>({});
  const [mapping, setMapping] = useState<MappingEntry[] | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  // Re-run the server-side analysis whenever options or mapping change.
  useEffect(() => {
    const my = ++reqId.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const p = await api<Preview>(`/uploads/${uploadId}/preview`, { body: { options, mapping } });
        if (my !== reqId.current) return;
        setPreview(p);
        setError(null);
        if (mapping === null) setMapping(p.mapping);
        if (p.upload.test_session_id && !sessionId) setSessionId(p.upload.test_session_id);
      } catch (e) {
        if (my !== reqId.current) return;
        setError(errorMessage(e));
      } finally {
        if (my === reqId.current) setLoading(false);
      }
    }, mapping === null ? 0 : 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadId, options, mapping]);

  useEffect(() => setAck(false), [preview?.counts.warnings]);

  const doImport = useMutation({
    meta: { silent: true },
    mutationFn: () =>
      api<Dataset>(`/uploads/${uploadId}/import`, {
        body: { options, mapping, acknowledge_warnings: ack, test_session_id: sessionId || null },
      }),
    onSuccess: (d) => {
      for (const k of ["battery", "datasets", "uploads", "battery-history", "evidence"]) qc.invalidateQueries({ queryKey: [k, id] });
      toast.success(`Imported ${d.imported_rows.toLocaleString("en-IN")} rows`);
      router.push(`/batteries/${id}?tab=diagnostics&dataset=${d.id}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.body?.preview) setPreview({ ...preview!, ...e.body.preview });
      toast.error(errorMessage(e));
    },
  });

  const fields = preview?.fields ?? {};
  const mapByColumn = useMemo(() => Object.fromEntries((mapping ?? []).map((m) => [m.column, m])), [mapping]);
  const mappedFields = new Set((mapping ?? []).map((m) => m.field));

  const setColumnField = (column: string, field: string) => {
    const rest = (mapping ?? []).filter((m) => m.column !== column);
    if (!field) return setMapping(rest);
    const unit = fields[field]?.units[0] ?? "";
    // Non-multi fields can be mapped once: moving one releases the other column.
    const cleaned = fields[field]?.multi ? rest : rest.filter((m) => m.field !== field);
    const timeClash = field === "time_elapsed" || field === "timestamp" ? cleaned.filter((m) => m.field !== "time_elapsed" && m.field !== "timestamp") : cleaned;
    const ordered = [...timeClash, { column, field, unit, unit_source: "user" as const }];
    const order = preview?.columns.map((c) => c.name) ?? [];
    ordered.sort((a, b) => order.indexOf(a.column) - order.indexOf(b.column));
    setMapping(ordered);
  };
  const updateEntry = (column: string, patch: Partial<MappingEntry>) =>
    setMapping((current) => (current ?? []).map((m) => (m.column === column ? { ...m, ...patch } : m)));
  const setStructural = (patch: ParserOptions) => {
    setOptions({ ...options, ...patch });
    setMapping(null); // column names may change; let the server suggest again
  };

  const upload = preview?.upload;
  const warnings = preview?.counts.warnings ?? 0;
  const errors = preview?.counts.errors ?? 0;
  const canImport = !!preview && preview.can_import && (!warnings || ack) && !loading;

  return (
    <div className="pb-28">
      <Link href={`/batteries/${id}?tab=files`} className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-4" /> {battery.data?.bos_id ?? "Battery"} · Files &amp; data
      </Link>
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">Preview and import</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">
            Check how BatteryOS reads this file before anything is imported. The original file is never changed; the import creates a
            normalized copy in standard units.
          </p>
        </div>
        {loading ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
            <Loader2 className="size-3.5 animate-spin" /> Re-checking…
          </span>
        ) : null}
      </div>

      {error && !preview ? (
        <Callout tone="rose" title="This file could not be read">
          {error}
        </Callout>
      ) : !preview ? (
        <LoadingBlock rows={8} />
      ) : (
        <div className="space-y-6">
          {error ? <Callout tone="rose">{error}</Callout> : null}
          <Card>
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                <FileSpreadsheet className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-zinc-900">{upload?.original_filename}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-zinc-500">
                  <span>{upload ? formatBytes(upload.size_bytes) : ""}</span>
                  <span>
                    {preview.row_count.toLocaleString("en-IN")} data rows · {preview.columns.length} columns
                  </span>
                  <span>
                    Uploaded by {upload?.uploaded_by?.full_name} · {formatDateTime(upload?.uploaded_at)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Fingerprint className="size-3.5" /> <Mono>{upload?.sha256.slice(0, 16)}…</Mono>
                  </span>
                </p>
              </div>
              <div className="flex gap-2">
                <Badge tone={errors ? "rose" : "emerald"}>{errors} error{errors === 1 ? "" : "s"}</Badge>
                <Badge tone={warnings ? "amber" : "zinc"}>{warnings} warning{warnings === 1 ? "" : "s"}</Badge>
              </div>
            </div>
            {preview.preamble.length ? (
              <div className="border-t border-zinc-100 px-4 py-3 sm:px-5">
                <p className="mb-1 text-xs font-medium text-zinc-500">Lines above the header (kept in the original file, not imported):</p>
                <pre className="max-h-24 overflow-auto rounded-md bg-zinc-50 p-2 font-mono text-[11px] text-zinc-600 scrollbar-thin">{preview.preamble.join("\n")}</pre>
              </div>
            ) : null}
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0 space-y-6">
              <Card>
                <CardHeader
                  icon={<Wand2 />}
                  title="Map columns"
                  description="Choose what each column contains and its unit. Columns you don't map stay in the original file only."
                  actions={
                    <Button size="sm" variant="ghost" onClick={() => setMapping(null)}>
                      Reset to suggestions
                    </Button>
                  }
                />
                <div className="divide-y divide-zinc-100">
                  {preview.columns.map((c) => {
                    const m = mapByColumn[c.name];
                    return (
                      <div key={c.name} className={cn("grid gap-3 px-4 py-3 sm:px-5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center", !m && "bg-zinc-50/40")}>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Mono className={cn("truncate font-medium", m ? "text-zinc-900" : "text-zinc-500")}>{c.name}</Mono>
                            <Badge tone="zinc" className="text-[10.5px]">
                              {c.inferred_type}
                            </Badge>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-zinc-400">
                            {c.sample.filter((s) => s !== "").slice(0, 3).join(" · ") || "empty"}
                            {c.min !== null && c.max !== null ? ` · range ${formatNumber(c.min, null, 3)} to ${formatNumber(c.max, null, 3)}` : ""}
                          </p>
                        </div>
                        <Select aria-label={`Import ${c.name} as`} value={m?.field ?? ""} onChange={(e) => setColumnField(c.name, e.target.value)} className={m ? "" : "text-zinc-500"}>
                          <option value="">Don&apos;t import</option>
                          {Object.entries(fields).map(([k, f]) => (
                            <option key={k} value={k} disabled={!f.multi && mappedFields.has(k) && m?.field !== k}>
                              {f.label}
                            </option>
                          ))}
                        </Select>
                        {m ? (
                          <div className="flex items-center gap-2">
                            <Select
                              aria-label={`Unit for ${c.name}`}
                              value={m.unit}
                              onChange={(e) => updateEntry(c.name, { unit: e.target.value, unit_source: "user" })}
                              className="w-28"
                            >
                              {(fields[m.field]?.units ?? [m.unit]).map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </Select>
                            <UnitSource m={m} onConfirm={() => updateEntry(c.name, { unit_source: "user" })} />
                          </div>
                        ) : (
                          <span className="hidden text-xs text-zinc-400 md:block">Not imported</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card>
                <CardHeader icon={<TableProperties />} title="File as read" description={`First ${preview.raw_rows.length} data rows, exactly as they appear in the file.`} />
                <div className="max-h-[420px] overflow-auto scrollbar-thin">
                  <table className="w-full border-collapse text-xs">
                    <thead className="sticky top-0 z-10 bg-zinc-50">
                      <tr>
                        <th className="border-b border-zinc-200 px-2 py-1.5 text-left font-medium text-zinc-400">Line</th>
                        {preview.columns.map((c) => (
                          <th key={c.name} className={cn("whitespace-nowrap border-b border-zinc-200 px-2 py-1.5 text-left font-medium", mapByColumn[c.name] ? "text-zinc-900" : "text-zinc-400")}>
                            <div className="font-mono">{c.name}</div>
                            {mapByColumn[c.name] ? (
                              <div className="mt-0.5 font-sans text-[10.5px] font-normal text-brand-700">
                                → {fields[mapByColumn[c.name].field]?.label} ({mapByColumn[c.name].unit})
                              </div>
                            ) : null}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.raw_rows.map((r) => (
                        <tr key={r.source_line} className="border-b border-zinc-100">
                          <td className="px-2 py-1 font-mono text-zinc-400">{r.source_line}</td>
                          {r.cells.map((cell, i) => (
                            <td key={i} className={cn("whitespace-nowrap px-2 py-1 font-mono", mapByColumn[preview.columns[i]?.name] ? "text-zinc-800" : "text-zinc-400")}>
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              {preview.normalized_preview.length ? (
                <Card>
                  <CardHeader title="After import" description="The same rows converted to standard units. Time is elapsed from the first valid row; discharge current is negative." />
                  <div className="max-h-[360px] overflow-auto scrollbar-thin">
                    <table className="w-full border-collapse text-xs">
                      <thead className="sticky top-0 bg-zinc-50">
                        <tr>
                          {Object.keys(preview.normalized_preview[0]).map((k) => (
                            <th key={k} className="whitespace-nowrap border-b border-zinc-200 px-2 py-1.5 text-left font-mono font-medium text-zinc-600">
                              {k === "source_line" ? "line" : k}
                              {CANON_UNITS[k] ? <span className="font-sans text-zinc-400"> ({CANON_UNITS[k]})</span> : null}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.normalized_preview.map((r, i) => (
                          <tr key={i} className="border-b border-zinc-100">
                            {Object.entries(r).map(([k, v]) => (
                              <td key={k} className={cn("tabular whitespace-nowrap px-2 py-1 font-mono", k === "source_line" ? "text-zinc-400" : "text-zinc-800")}>
                                {v === null ? <span className="text-zinc-300">—</span> : typeof v === "number" ? formatNumber(v, null, 4) : v}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ) : null}
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader icon={<Settings2 />} title="How the file is read" description="Detected automatically. Change anything that looks wrong." />
                <div className="grid grid-cols-2 gap-3 p-4 sm:p-5">
                  <Field label="Delimiter" htmlFor="opt-delim" hint={preview.parser.auto.delimiter ? "Detected" : "Set by you"}>
                    <Select id="opt-delim" value={options.delimiter ?? preview.parser.delimiter} onChange={(e) => setStructural({ delimiter: e.target.value })}>
                      <option value=",">Comma ( , )</option>
                      <option value=";">Semicolon ( ; )</option>
                      <option value={"\t"}>Tab</option>
                      <option value="|">Pipe ( | )</option>
                    </Select>
                  </Field>
                  <Field label="Header is on line" htmlFor="opt-header" hint={preview.parser.auto.header_row ? "Detected" : "Set by you"}>
                    <Input
                      id="opt-header"
                      type="number"
                      min={1}
                      value={(options.header_row ?? preview.parser.header_row) + 1}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (v >= 1) setStructural({ header_row: v - 1 });
                      }}
                    />
                  </Field>
                  <Field label="Decimal mark" htmlFor="opt-dec" hint={preview.parser.auto.decimal ? "Detected" : "Set by you"}>
                    <Select id="opt-dec" value={options.decimal ?? preview.parser.decimal} onChange={(e) => setOptions({ ...options, decimal: e.target.value })}>
                      <option value=".">Point (3.45)</option>
                      <option value=",">Comma (3,45)</option>
                    </Select>
                  </Field>
                  <Field label="Text encoding" htmlFor="opt-enc">
                    <Select id="opt-enc" value={options.encoding ?? preview.parser.encoding} onChange={(e) => setStructural({ encoding: e.target.value })}>
                      <option value="utf-8">UTF-8</option>
                      <option value="utf-16">UTF-16</option>
                      <option value="cp1252">Windows-1252</option>
                      <option value="latin-1">Latin-1</option>
                    </Select>
                  </Field>
                  {mappedFields.has("timestamp") ? (
                    <Field label="Date order" htmlFor="opt-dayfirst" className="col-span-2" hint={preview.parser.dayfirst_detected === "ambiguous" ? "Ambiguous in this file — please confirm." : undefined}>
                      <Select
                        id="opt-dayfirst"
                        value={options.dayfirst === undefined || options.dayfirst === null ? "" : options.dayfirst ? "day" : "month"}
                        onChange={(e) => setOptions({ ...options, dayfirst: e.target.value === "" ? null : e.target.value === "day" })}
                      >
                        <option value="">Detect automatically</option>
                        <option value="day">Day first (dd/mm/yyyy)</option>
                        <option value="month">Month first (mm/dd/yyyy)</option>
                      </Select>
                    </Field>
                  ) : null}
                  {mappedFields.has("current") ? (
                    <Field label="Current sign in this file" htmlFor="opt-sign" className="col-span-2">
                      <Select
                        id="opt-sign"
                        value={options.current_sign ?? ""}
                        onChange={(e) => setOptions({ ...options, current_sign: (e.target.value || null) as ParserOptions["current_sign"] })}
                      >
                        <option value="">Not confirmed (assume discharge is negative)</option>
                        <option value="discharge_negative">Discharge is negative</option>
                        <option value="discharge_positive">Discharge is positive</option>
                      </Select>
                    </Field>
                  ) : null}
                </div>
              </Card>

              <Card>
                <CardHeader title="Validation" description="Checked on the server every time you change something." />
                <div className="p-4 sm:p-5">
                  <IssueList issues={preview.issues} />
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}

      {preview ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-[1440px] flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:px-8">
            <div className="flex-1 text-sm">
              {errors ? (
                <span className="font-medium text-rose-700">Fix {errors} error{errors === 1 ? "" : "s"} to import.</span>
              ) : (
                <span className="text-zinc-700">
                  <strong className="tabular">{preview.importable_rows.toLocaleString("en-IN")}</strong> of {preview.row_count.toLocaleString("en-IN")} rows ready to import
                  {warnings ? ` · ${warnings} warning${warnings === 1 ? "" : "s"} to review` : ""}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {sessions.data?.length ? (
                <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)} className="w-auto max-w-64" aria-label="Test session">
                  <option value="">No test session</option>
                  {sessions.data.map((s) => (
                    <option key={s.id} value={s.id}>
                      {label(TEST_TYPE_LABELS, s.test_type)} · {s.test_date}
                    </option>
                  ))}
                </Select>
              ) : null}
              {warnings && !errors ? (
                <Checkbox checked={ack} onChange={setAck} label={`I have reviewed the ${warnings} warning${warnings === 1 ? "" : "s"}`} />
              ) : null}
              <Button variant="brand" size="lg" disabled={!canImport} loading={doImport.isPending} onClick={() => doImport.mutate()}>
                Import data
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
