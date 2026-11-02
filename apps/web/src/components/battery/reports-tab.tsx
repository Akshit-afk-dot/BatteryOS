"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight, FileText, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { GeneratorBadge, KindBadge, ReportStatusBadge } from "@/components/badges";
import { Dialog } from "@/components/overlay";
import { Badge, Button, Callout, Card, CardHeader, Checkbox, EmptyState, Field, Input, LoadingBlock, Mono, Switch } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Battery, EvidenceCandidate, Report } from "@/lib/types";

const GROUPS: { type: EvidenceCandidate["type"]; title: string }[] = [
  { type: "battery_record", title: "Battery record" },
  { type: "test_session", title: "Test sessions" },
  { type: "measurement", title: "Recorded results" },
  { type: "dataset", title: "Imported data (calculated values and validation findings)" },
  { type: "note", title: "Technician notes" },
  { type: "file", title: "Photos and documents (descriptions only)" },
  { type: "completeness", title: "Completeness check" },
];

export function DraftReportDialog({ battery, open, onOpenChange }: { battery: Battery; open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const ev = useQuery({
    queryKey: ["evidence", battery.id],
    queryFn: () => api<{ items: EvidenceCandidate[]; ai: { configured: boolean; model: string | null } }>(`/batteries/${battery.id}/evidence`),
    enabled: open,
  });
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [useAi, setUseAi] = useState(true);
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (ev.data && selected === null) setSelected(new Set(ev.data.items.filter((i) => i.default).map((i) => i.ref)));
  }, [ev.data, selected]);
  const aiReady = !!ev.data?.ai.configured;
  const create = useMutation({
    mutationFn: () =>
      api<Report>(`/batteries/${battery.id}/report-drafts`, {
        body: { include: [...(selected ?? [])], use_ai: aiReady && useAi, title: title || null },
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["reports", battery.id] });
      qc.invalidateQueries({ queryKey: ["battery", battery.id] });
      if (r.notice) toast.warning(r.notice);
      else toast.success(`${r.report_number} drafted`);
      router.push(`/reports/${r.id}`);
    },
  });
  const grouped = useMemo(() => {
    const items = ev.data?.items ?? [];
    return GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.type === g.type) })).filter((g) => g.items.length);
  }, [ev.data]);
  const toggle = (ref: string, on: boolean) => {
    const next = new Set(selected ?? []);
    if (on) next.add(ref);
    else next.delete(ref);
    setSelected(next);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Draft a diagnostic report"
      description="Choose exactly which records the draft may use. Nothing outside your selection is sent to the AI or quoted in the report."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} disabled={!selected || selected.size === 0} onClick={() => create.mutate()}>
            {aiReady && useAi ? <Sparkles /> : null}
            Create draft
          </Button>
        </>
      }
    >
      {ev.isLoading || !selected ? (
        <LoadingBlock rows={5} />
      ) : (
        <div className="space-y-5">
          <Field label="Title (optional)" htmlFor="rep-title">
            <Input id="rep-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Diagnostic report for ${battery.bos_id}`} />
          </Field>
          <div className="flex items-start justify-between gap-4 rounded-lg bg-zinc-50 p-3 ring-1 ring-zinc-200">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-900">
                <Sparkles className="size-4 text-fuchsia-600" /> Draft the narrative with AI
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {aiReady
                  ? `Uses ${ev.data?.ai.model}. It may only quote the selected records, must cite them, and cannot make safety, SOH or final-decision claims. Automatic checks flag anything that slips through.`
                  : "AI is not configured on this server. A plain template draft will be created from the same records."}
              </p>
            </div>
            <Switch checked={aiReady && useAi} onChange={setUseAi} disabled={!aiReady} />
          </div>
          {grouped.map((g) => (
            <div key={g.type}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">{g.title}</p>
              <div className="divide-y divide-zinc-100 rounded-lg ring-1 ring-zinc-200">
                {g.items.map((i) => (
                  <div key={i.ref} className="flex items-start gap-3 px-3 py-2.5">
                    <Checkbox
                      checked={selected.has(i.ref)}
                      onChange={(on) => toggle(i.ref, on)}
                      disabled={i.ref === "battery"}
                      className="min-w-0 flex-1"
                      label={i.label}
                      description={i.summary || undefined}
                    />
                    <KindBadge kind={i.origin} compact />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {grouped.length <= 2 ? (
            <Callout tone="amber" icon={<AlertTriangle />}>
              There is very little on record for this battery. The draft will say so rather than fill gaps.
            </Callout>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

export function ReportsTab({ battery }: { battery: Battery }) {
  const { can } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const reports = useQuery({ queryKey: ["reports", battery.id], queryFn: () => api<Report[]>(`/batteries/${battery.id}/reports`) });
  const [open, setOpen] = useState(params.get("draft") === "1");
  const close = (o: boolean) => {
    setOpen(o);
    if (!o && params.get("draft")) {
      const next = new URLSearchParams(params.toString());
      next.delete("draft");
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    }
  };
  return (
    <>
      <Card>
        <CardHeader
          icon={<FileText />}
          title="Diagnostic reports"
          description="Drafted from selected evidence, reviewed and approved by a qualified person. Approved versions are locked."
          actions={
            can("reports.draft") ? (
              <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
                <Plus /> Draft report
              </Button>
            ) : null
          }
        />
        {reports.isLoading ? (
          <div className="p-4"><LoadingBlock /></div>
        ) : !reports.data?.length ? (
          <EmptyState
            icon={<FileText />}
            title="No reports yet"
            description="Once results, data and observations are on record, draft a report for review."
            action={can("reports.draft") ? <Button variant="primary" onClick={() => setOpen(true)}>Draft report</Button> : null}
          />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {reports.data.map((r) => (
              <li key={r.id}>
                <Link href={`/reports/${r.id}`} className="flex flex-col gap-2 px-4 py-3 hover:bg-zinc-50 sm:flex-row sm:items-center sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Mono className="font-semibold text-zinc-900">
                        {r.report_number} v{r.version}
                      </Mono>
                      <ReportStatusBadge status={r.status} />
                      <GeneratorBadge generator={r.generator} />
                      {r.status === "draft" && r.open_checks ? (
                        <Badge tone="amber">
                          <AlertTriangle /> {r.open_checks} to review
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate text-sm text-zinc-600">{r.title}</p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      Drafted by {r.generated_by?.full_name} · {formatDateTime(r.generated_at)}
                      {r.approved_by ? ` · approved by ${r.approved_by.full_name} on ${formatDateTime(r.approved_at)}` : ""}
                    </p>
                  </div>
                  <ChevronRight className="hidden size-4 text-zinc-300 sm:block" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {open ? <DraftReportDialog battery={battery} open={open} onOpenChange={close} /> : null}
    </>
  );
}
