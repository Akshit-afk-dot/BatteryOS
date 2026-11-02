"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  BookMarked,
  CheckCircle2,
  Download,
  FileStack,
  Lock,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { GeneratorBadge, KindBadge, OriginBadge, ProvenanceBadge, ReportStatusBadge } from "@/components/badges";
import { ConfirmDialog, Dialog, Menu, MenuContent, MenuItem, MenuTrigger, Tooltip } from "@/components/overlay";
import { Badge, Button, Callout, Card, CardHeader, Checkbox, Input, LoadingBlock, Mono, Switch, Table, TD, TH, THead, TR, Textarea } from "@/components/ui";
import { api, apiUrl } from "@/lib/api";
import { BATTERY_TYPE_LABELS, cn, formatDate, formatDateTime, formatNumber, label } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { EvidenceCandidate, EvidenceItem, Paragraph, Report, ReportCheck, ReportSection } from "@/lib/types";

// ---------------------------------------------------------------- record blocks (deterministic, from the evidence snapshot)

function RecordBlocks({ evidence }: { evidence: EvidenceItem[] }) {
  const bat = evidence.find((e) => e.type === "battery_record");
  const measurements = evidence.filter((e) => e.type === "measurement");
  const datasets = evidence.filter((e) => e.type === "dataset");
  const inspections = evidence.filter((e) => e.type === "note" && e.data.inspection_checklist);
  const d = bat?.data ?? {};
  const src: Record<string, string> = d.value_sources ?? {};
  const fields: [string, string, string | null][] = [
    ["chemistry", "Chemistry", null],
    ["nominal_voltage_v", "Nominal voltage", "V"],
    ["rated_capacity_ah", "Rated capacity", "Ah"],
    ["pack_configuration", "Pack configuration", null],
    ["manufacturer", "Manufacturer", null],
    ["model", "Model", null],
    ["serial_number", "Serial number", null],
    ["bms_info", "BMS", null],
  ];
  return (
    <Card>
      <CardHeader
        icon={<BookMarked />}
        title="From the records"
        description="Copied from the selected records when the draft was made. Shown in the report exactly as below — not editable here."
      />
      <div className="space-y-6 p-4 sm:p-5">
        {bat ? (
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Battery identification <Mono className="text-zinc-400">[{bat.key}]</Mono>
            </p>
            <div className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">BatteryOS ID</span>
                <Mono className="text-zinc-900">{d.battery_id}</Mono>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-500">Type</span>
                <span className="text-zinc-900">{label(BATTERY_TYPE_LABELS, d.battery_type)}</span>
              </div>
              {fields.map(([k, title, unit]) => (
                <div key={k} className="flex items-center justify-between gap-3">
                  <span className="text-zinc-500">{title}</span>
                  <span className="flex items-center gap-2 text-right text-zinc-900">
                    {d[k] === null || d[k] === undefined || d[k] === "unknown" ? <span className="text-zinc-400">Unknown</span> : unit ? formatNumber(d[k], unit) : String(d[k])}
                    <ProvenanceBadge source={src[k] ?? "unknown"} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {measurements.length ? (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Recorded results</p>
            <div className="overflow-hidden rounded-lg ring-1 ring-zinc-200">
              <Table>
                <THead>
                  <tr>
                    <TH>Ref</TH>
                    <TH>Quantity</TH>
                    <TH>Value</TH>
                    <TH>Kind</TH>
                    <TH className="hidden md:table-cell">Conditions / source</TH>
                  </tr>
                </THead>
                <tbody>
                  {measurements.map((m) => (
                    <TR key={m.key}>
                      <TD>
                        <Mono className="text-zinc-400">{m.key}</Mono>
                      </TD>
                      <TD>{m.data.quantity}</TD>
                      <TD className="tabular whitespace-nowrap font-semibold text-zinc-900">{m.data.value !== null ? formatNumber(m.data.value, m.data.unit, 4) : m.data.value_text}</TD>
                      <TD>
                        <KindBadge kind={m.data.kind} />
                      </TD>
                      <TD className="hidden text-xs text-zinc-500 md:table-cell">
                        {[m.data.conditions, m.data.source ? `Source: ${m.data.source}` : null, m.data.test_session ? `Session [${m.data.test_session}]` : null].filter(Boolean).join(" · ") ||
                          "Conditions not recorded"}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </div>
          </div>
        ) : null}
        {datasets.map((ds) => (
          <div key={ds.key}>
            <p className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Calculated from {ds.data.file} <Mono className="normal-case text-zinc-400">[{ds.key}]</Mono> <KindBadge kind="calculated" />
            </p>
            <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {(ds.data.calculated_metrics ?? []).map((m: any) => (
                <Tooltip key={m.metric} content={m.method}>
                  <div className="flex cursor-help justify-between gap-3 border-b border-dotted border-zinc-200 py-1">
                    <span className="text-zinc-500">{m.metric}</span>
                    <span className="tabular text-zinc-900">{formatNumber(m.value, m.unit, 4)}</span>
                  </div>
                </Tooltip>
              ))}
            </div>
            {ds.data.validation_findings?.length ? (
              <p className="mt-2 text-xs text-amber-800">
                {ds.data.validation_findings.length} validation warning(s) acknowledged at import are listed in the PDF.
              </p>
            ) : null}
          </div>
        ))}
        {inspections.map((n) => (
          <div key={n.key}>
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Inspection by {n.data.author} <Mono className="normal-case text-zinc-400">[{n.key}]</Mono>
            </p>
            <ul className="grid gap-1 text-sm sm:grid-cols-2">
              {n.data.inspection_checklist.map((c: any) => (
                <li key={c.item} className="flex items-start gap-2">
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", c.result === "ok" ? "bg-emerald-500" : c.result === "issue" ? "bg-amber-500" : "bg-zinc-300")} />
                  <span className={c.result === "not_checked" ? "text-zinc-400" : "text-zinc-700"}>
                    {c.item}
                    {c.result === "issue" ? <span className="text-amber-800"> — {c.comment || "issue noted"}</span> : c.result === "not_checked" ? " — not checked" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- narrative editing

function CitationChip({ k, evidence, onRemove }: { k: string; evidence: EvidenceItem[]; onRemove?: () => void }) {
  const item = evidence.find((e) => e.key === k);
  return (
    <Tooltip content={item ? item.label : "Not in this report's evidence"}>
      <span className={cn("inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[11px] ring-1", item ? "bg-zinc-50 text-zinc-600 ring-zinc-200" : "bg-rose-50 text-rose-700 ring-rose-200")}>
        {k}
        {onRemove ? (
          <button onClick={onRemove} className="ml-0.5 text-zinc-400 hover:text-zinc-800" aria-label={`Remove citation ${k}`}>
            <X className="size-3" />
          </button>
        ) : null}
      </span>
    </Tooltip>
  );
}

function AutoTextarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Textarea
      {...props}
      rows={1}
      className={cn("min-h-0 resize-none overflow-hidden", props.className)}
      ref={(el) => {
        if (el) {
          el.style.height = "auto";
          el.style.height = `${el.scrollHeight + 2}px`;
        }
      }}
      onInput={(e) => {
        const el = e.currentTarget;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight + 2}px`;
      }}
    />
  );
}

function SectionEditor({
  section,
  evidence,
  checks,
  editable,
  onChange,
}: {
  section: ReportSection;
  evidence: EvidenceItem[];
  checks: ReportCheck[];
  editable: boolean;
  onChange: (s: ReportSection) => void;
}) {
  const setPara = (i: number, p: Paragraph) => onChange({ ...section, paragraphs: section.paragraphs.map((x, j) => (j === i ? p : x)) });
  return (
    <Card id={`section-${section.key}`}>
      <CardHeader title={section.title} actions={<OriginBadge origin={section.origin} />} />
      <div className="space-y-3 p-4 sm:p-5">
        {section.paragraphs.length === 0 ? <p className="text-sm text-zinc-400">No text in this section.</p> : null}
        {section.paragraphs.map((p, i) => {
          const pChecks = checks.filter((c) => c.section === section.key && c.paragraph === i);
          const flagged = pChecks.some((c) => c.severity === "warning");
          return (
            <div key={i} id={`p-${section.key}-${i}`} className={cn("rounded-lg", flagged && "bg-amber-50/50 p-2 ring-1 ring-amber-200")}>
              {editable ? (
                <div className="group flex gap-2">
                  <AutoTextarea value={p.text} onChange={(e) => setPara(i, { ...p, text: e.target.value })} className="text-[14px] leading-relaxed" />
                  <button
                    className="mt-1 h-7 rounded p-1 text-zinc-300 opacity-0 transition-opacity hover:bg-zinc-100 hover:text-rose-600 group-hover:opacity-100 focus:opacity-100"
                    onClick={() => onChange({ ...section, paragraphs: section.paragraphs.filter((_, j) => j !== i) })}
                    aria-label="Delete paragraph"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ) : (
                <p className="text-[14px] leading-relaxed text-zinc-800">{p.text}</p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {p.citations.map((c) => (
                  <CitationChip key={c} k={c} evidence={evidence} onRemove={editable ? () => setPara(i, { ...p, citations: p.citations.filter((x) => x !== c) }) : undefined} />
                ))}
                {editable ? (
                  <Menu>
                    <MenuTrigger className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 ring-1 ring-dashed ring-zinc-300 hover:text-zinc-800">
                      <Plus className="size-3" /> cite
                    </MenuTrigger>
                    <MenuContent align="start" className="max-h-72 w-80 overflow-y-auto">
                      {evidence
                        .filter((e) => !p.citations.includes(e.key))
                        .map((e) => (
                          <MenuItem key={e.key} onSelect={() => setPara(i, { ...p, citations: [...p.citations, e.key] })}>
                            <Mono className="w-7 shrink-0 text-zinc-500">{e.key}</Mono>
                            <span className="truncate">{e.label}</span>
                          </MenuItem>
                        ))}
                    </MenuContent>
                  </Menu>
                ) : null}
              </div>
              {pChecks.length ? (
                <ul className="mt-1.5 space-y-1">
                  {pChecks.map((c, n) => (
                    <li key={n} className={cn("flex items-start gap-1.5 text-xs", c.severity === "warning" ? "text-amber-800" : "text-zinc-500")}>
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      {c.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
        {editable ? (
          <Button variant="ghost" size="sm" onClick={() => onChange({ ...section, paragraphs: [...section.paragraphs, { text: "", citations: [] }] })}>
            <Plus /> Add paragraph
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- dialogs

function ApproveDialog({ report, open, onOpenChange, conclusion }: { report: Report; open: boolean; onOpenChange: (o: boolean) => void; conclusion: string }) {
  const qc = useQueryClient();
  const warnings = (report.checks ?? []).filter((c) => c.severity === "warning");
  const [ack, setAck] = useState(false);
  const approve = useMutation({
    mutationFn: () => api<Report>(`/reports/${report.id}/approve`, { body: { acknowledge_checks: ack } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report", report.id] });
      qc.invalidateQueries({ queryKey: ["reports", report.battery_id] });
      qc.invalidateQueries({ queryKey: ["battery", report.battery_id] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`${report.report_number} v${report.version} approved`);
      onOpenChange(false);
    },
  });
  const noConclusion = !conclusion.trim();
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Approve this report"
      description="Approval records your name and time and locks this version. Corrections after approval need a new revision."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="brand" disabled={noConclusion || (warnings.length > 0 && !ack)} loading={approve.isPending} onClick={() => approve.mutate()}>
            <BadgeCheck /> Approve report
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {noConclusion ? (
          <Callout tone="rose" icon={<ShieldAlert />} title="Reviewer conclusion missing">
            Write your conclusion in the report and save it before approving.
          </Callout>
        ) : null}
        {warnings.length ? (
          <>
            <Callout tone="amber" icon={<AlertTriangle />} title={`${warnings.length} flagged statement${warnings.length === 1 ? "" : "s"}`}>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {warnings.slice(0, 6).map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
              {warnings.length > 6 ? <p className="mt-1">…and {warnings.length - 6} more.</p> : null}
            </Callout>
            <Checkbox
              checked={ack}
              onChange={setAck}
              label="I have checked the flagged statements against the evidence"
              description="Your confirmation is recorded with the approval."
            />
          </>
        ) : (
          <Callout tone="emerald" icon={<CheckCircle2 />}>
            No statements are flagged by the automatic checks. You remain responsible for the conclusions.
          </Callout>
        )}
        <p className="text-xs leading-relaxed text-zinc-500">
          BatteryOS reports are operational records, not safety certificates. The PDF states this and labels every value with its source.
        </p>
      </div>
    </Dialog>
  );
}

function RegenerateDialog({ report, open, onOpenChange }: { report: Report; open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const ev = useQuery({
    queryKey: ["evidence", report.battery_id],
    queryFn: () => api<{ items: EvidenceCandidate[]; ai: { configured: boolean; model: string | null } }>(`/batteries/${report.battery_id}/evidence`),
    enabled: open,
  });
  const current = useMemo(() => new Set((report.evidence ?? []).map((e) => e.ref)), [report.evidence]);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [useAi, setUseAi] = useState(true);
  useEffect(() => {
    if (ev.data && !selected) setSelected(new Set(ev.data.items.filter((i) => current.has(i.ref) || i.default).map((i) => i.ref)));
  }, [ev.data, selected, current]);
  const ai = !!ev.data?.ai.configured;
  const regen = useMutation({
    mutationFn: () => api<Report>(`/reports/${report.id}/regenerate`, { body: { include: [...(selected ?? [])], use_ai: ai && useAi } }),
    onSuccess: (r) => {
      qc.setQueryData(["report", report.id], (old: Report | undefined) => ({ ...old, ...r }));
      qc.invalidateQueries({ queryKey: ["report", report.id] });
      if (r.notice) toast.warning(r.notice);
      else toast.success("Draft regenerated");
      onOpenChange(false);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Redraft from current records"
      description="Replaces the narrative and the evidence snapshot with a fresh draft. Your edits to the narrative will be lost; the reviewer conclusion is kept."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={regen.isPending} onClick={() => regen.mutate()}>
            <RefreshCw /> Redraft
          </Button>
        </>
      }
    >
      {!ev.data || !selected ? (
        <LoadingBlock />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-zinc-50 p-3 ring-1 ring-zinc-200">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="size-4 text-fuchsia-600" /> Use AI {ai ? `(${ev.data.ai.model})` : "(not configured)"}
            </span>
            <Switch checked={ai && useAi} onChange={setUseAi} disabled={!ai} />
          </div>
          <div className="max-h-[45vh] divide-y divide-zinc-100 overflow-y-auto rounded-lg ring-1 ring-zinc-200 scrollbar-thin">
            {ev.data.items.map((i) => (
              <div key={i.ref} className="flex items-start gap-3 px-3 py-2">
                <Checkbox
                  checked={selected.has(i.ref)}
                  disabled={i.ref === "battery"}
                  onChange={(on) => {
                    const n = new Set(selected);
                    if (on) n.add(i.ref);
                    else n.delete(i.ref);
                    setSelected(n);
                  }}
                  className="min-w-0 flex-1"
                  label={i.label}
                  description={i.summary || undefined}
                />
                <KindBadge kind={i.origin} compact />
              </div>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------- page

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["report", id], queryFn: () => api<Report>(`/reports/${id}`) });
  const r = q.data;
  const [sections, setSections] = useState<ReportSection[] | null>(null);
  const [conclusion, setConclusion] = useState<string>("");
  const [title, setTitle] = useState("");
  const [approveOpen, setApproveOpen] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  useEffect(() => {
    if (r) {
      setSections(r.sections ?? []);
      setConclusion(r.reviewer_conclusion ?? "");
      setTitle(r.title);
    }
  }, [r]);

  const editable = !!r && r.status === "draft" && can("reports.draft");
  const dirty =
    !!r &&
    !!sections &&
    (JSON.stringify(sections) !== JSON.stringify(r.sections) || conclusion !== (r.reviewer_conclusion ?? "") || title !== r.title);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () =>
      api<Report>(`/reports/${id}`, {
        method: "PATCH",
        body: { title, reviewer_conclusion: conclusion, sections: sections?.map((s) => ({ ...s, paragraphs: s.paragraphs.filter((p) => p.text.trim()) })) },
      }),
    onSuccess: (res) => {
      qc.setQueryData(["report", id], (old: Report | undefined) => ({ ...old, ...res }));
      qc.invalidateQueries({ queryKey: ["reports", res.battery_id] });
      toast.success("Draft saved");
    },
  });
  const revise = useMutation({
    mutationFn: () => api<Report>(`/reports/${id}/revise`, { method: "POST" }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["reports", res.battery_id] });
      toast.success(`Revision v${res.version} started`);
      router.push(`/reports/${res.id}`);
    },
  });

  if (q.isLoading || !r || !sections) return <LoadingBlock rows={8} />;
  const checks = r.checks ?? [];
  const warnings = checks.filter((c) => c.severity === "warning");
  const latest = r.versions?.[0];

  return (
    <div className={cn(dirty && "pb-24")}>
      <Link href={`/batteries/${r.battery_id}?tab=reports`} className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-4" /> {r.battery?.bos_id} · Reports
      </Link>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Mono className="text-sm font-semibold text-zinc-500">
              {r.report_number} · v{r.version}
            </Mono>
            <ReportStatusBadge status={r.status} />
            <GeneratorBadge generator={r.generator} />
          </div>
          {editable ? (
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-2 h-auto max-w-2xl border-0 bg-transparent px-0 py-1 text-xl font-semibold tracking-tight ring-0 focus:ring-0 sm:text-2xl" aria-label="Report title" />
          ) : (
            <h1 className="mt-2 text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">{r.title}</h1>
          )}
          <p className="mt-1 text-xs text-zinc-500">
            Drafted by {r.generated_by?.full_name} on {formatDateTime(r.generated_at)} from {r.evidence?.length ?? 0} records
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(r.versions?.length ?? 0) > 1 ? (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary" size="sm">
                  <FileStack /> v{r.version} of {r.versions?.length}
                </Button>
              </MenuTrigger>
              <MenuContent>
                {r.versions?.map((v) => (
                  <MenuItem key={v.id} onSelect={() => router.push(`/reports/${v.id}`)}>
                    v{v.version} · {v.status}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>
          ) : null}
          <a href={apiUrl(`/reports/${r.id}/pdf`)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[13px] font-medium text-zinc-800 shadow-card ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50">
            <Download className="size-4" /> PDF
          </a>
          {editable ? (
            <Button variant="secondary" size="sm" onClick={() => setRegenOpen(true)}>
              <RefreshCw /> Redraft
            </Button>
          ) : null}
          {r.status === "draft" && can("reports.approve") ? (
            <Tooltip content={dirty ? "Save your changes first" : undefined}>
              <span>
                <Button variant="brand" size="sm" disabled={dirty} onClick={() => setApproveOpen(true)}>
                  <BadgeCheck /> Approve
                </Button>
              </span>
            </Tooltip>
          ) : null}
          {r.status !== "draft" && latest?.id === r.id && can("reports.draft") ? (
            <Button variant="secondary" size="sm" loading={revise.isPending} onClick={() => revise.mutate()}>
              <Plus /> New revision
            </Button>
          ) : null}
        </div>
      </div>

      {r.status === "approved" ? (
        <Callout tone="emerald" icon={<Lock />} className="mb-6" title={`Approved by ${r.approved_by?.full_name} on ${formatDateTime(r.approved_at)}`}>
          This version is locked. To correct it, start a new revision; this version stays on record.
        </Callout>
      ) : r.status === "superseded" ? (
        <Callout tone="zinc" icon={<Lock />} className="mb-6" title="Superseded">
          A later version of this report was approved.{" "}
          {latest ? (
            <Link href={`/reports/${latest.id}`} className="font-medium underline">
              Open v{latest.version}
            </Link>
          ) : null}
        </Callout>
      ) : (
        <Callout tone="amber" icon={<AlertTriangle />} className="mb-6" title="Draft for internal review — not approved">
          Check every statement against the evidence, write your conclusion, then approve. The PDF of a draft is watermarked.
        </Callout>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-6">
          <RecordBlocks evidence={r.evidence ?? []} />
          {sections.map((s, i) => (
            <SectionEditor
              key={s.key}
              section={s}
              evidence={r.evidence ?? []}
              checks={dirty ? [] : checks}
              editable={editable}
              onChange={(ns) => setSections(sections.map((x, j) => (j === i ? ns : x)))}
            />
          ))}
          <Card className={cn(editable && !conclusion.trim() && "ring-2 ring-amber-200")}>
            <CardHeader
              title="Reviewer conclusion"
              description="Written by the qualified person approving this report — never by the AI. Required before approval."
              actions={<OriginBadge origin="human" />}
            />
            <div className="p-4 sm:p-5">
              {editable ? (
                <Textarea
                  id="conclusion"
                  aria-label="Reviewer conclusion"
                  rows={5}
                  value={conclusion}
                  onChange={(e) => setConclusion(e.target.value)}
                  placeholder="Your conclusion and any decision (repair, reuse, rejection) in your own words."
                />
              ) : (
                <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-zinc-800">{r.reviewer_conclusion || <span className="text-zinc-400">Not written yet.</span>}</p>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-6 xl:sticky xl:top-20 xl:self-start">
          <Card>
            <CardHeader
              icon={<ShieldAlert />}
              title="Automatic checks"
              description={dirty ? "Save to re-run the checks on your edits." : "Numbers not in the evidence, uncited statements and prohibited claims."}
            />
            <div className="max-h-[40vh] overflow-y-auto p-4 scrollbar-thin">
              {dirty ? (
                <p className="text-sm text-zinc-500">Unsaved changes.</p>
              ) : warnings.length === 0 ? (
                <p className="flex items-center gap-1.5 text-sm text-emerald-700">
                  <CheckCircle2 className="size-4" /> No flagged statements.
                </p>
              ) : (
                <ul className="space-y-2">
                  {checks.map((c, i) => (
                    <li key={i}>
                      <button
                        className={cn("w-full rounded-lg p-2.5 text-left text-xs ring-1", c.severity === "warning" ? "bg-amber-50 ring-amber-200 hover:bg-amber-100/60" : "bg-zinc-50 ring-zinc-200")}
                        onClick={() => {
                          const el = document.getElementById(c.paragraph !== null ? `p-${c.section}-${c.paragraph}` : `section-${c.section}`);
                          el?.scrollIntoView({ behavior: "smooth", block: "center" });
                        }}
                      >
                        <span className="font-semibold text-zinc-800">{sections.find((s) => s.key === c.section)?.title ?? c.section}</span>
                        <span className="mt-0.5 block text-zinc-700">{c.message}</span>
                        {c.excerpt ? <span className="mt-1 block truncate italic text-zinc-500">“{c.excerpt}”</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader icon={<BookMarked />} title="Evidence index" description="The only records this draft could use." />
            <ul className="max-h-[40vh] divide-y divide-zinc-100 overflow-y-auto scrollbar-thin">
              {(r.evidence ?? []).map((e) => (
                <li key={e.key} className="flex items-start gap-2 px-4 py-2">
                  <Mono className="w-7 shrink-0 pt-0.5 text-zinc-400">{e.key}</Mono>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-zinc-800">{e.label}</p>
                    {e.summary ? <p className="truncate text-xs text-zinc-500">{e.summary}</p> : null}
                  </div>
                  <KindBadge kind={e.origin} compact />
                </li>
              ))}
            </ul>
          </Card>
          <p className="px-1 text-xs leading-relaxed text-zinc-500">
            BatteryOS never certifies a battery as safe or fit for use, and never estimates state of health without a validated model. Battery
            received {formatDate(r.battery?.received_date)}.
          </p>
        </div>
      </div>

      {dirty && editable ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <span className="flex items-center gap-2 text-sm text-zinc-700">
              <Badge tone="amber" dot>
                Unsaved
              </Badge>
              Edited text is labelled as edited by a person.
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setDiscardOpen(true)}>
                Discard
              </Button>
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
                Save draft
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ApproveDialog report={r} open={approveOpen} onOpenChange={setApproveOpen} conclusion={r.reviewer_conclusion ?? ""} />
      {regenOpen ? <RegenerateDialog report={r} open={regenOpen} onOpenChange={setRegenOpen} /> : null}
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard your changes?"
        description="The draft goes back to its last saved version."
        confirmLabel="Discard"
        danger
        onConfirm={() => {
          setSections(r.sections ?? []);
          setConclusion(r.reviewer_conclusion ?? "");
          setTitle(r.title);
          setDiscardOpen(false);
        }}
      />
    </div>
  );
}
