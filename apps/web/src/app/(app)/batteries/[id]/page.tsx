"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, FilePlus2, FileText, Receipt, Upload } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { DiagnosticsTab } from "@/components/battery/diagnostics-tab";
import { FilesTab } from "@/components/battery/files-tab";
import { HistoryTab } from "@/components/battery/history-tab";
import { OverviewTab } from "@/components/battery/overview-tab";
import { QuotationsTab } from "@/components/battery/quotations-tab";
import { ReportsTab } from "@/components/battery/reports-tab";
import { StatusControl } from "@/components/battery/status-control";
import { TestsTab } from "@/components/battery/tests-tab";
import { ButtonLink, Callout, LoadingBlock, Mono, Skeleton } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAssistantBattery } from "@/lib/assistant-context";
import { BATTERY_TYPE_LABELS, cn, formatDate, label, ratings } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Battery } from "@/lib/types";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "files", label: "Files & data", count: "uploads" },
  { key: "diagnostics", label: "Diagnostics", count: "datasets" },
  { key: "tests", label: "Tests & notes", count: "measurements" },
  { key: "reports", label: "Reports", count: "reports" },
  { key: "quotations", label: "Quotations", count: "quotations" },
  { key: "history", label: "History" },
] as const;

function useBattery(id: string) {
  return useQuery({ queryKey: ["battery", id], queryFn: () => api<Battery>(`/batteries/${id}`) });
}

function BatteryDetail() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { can } = useSession();
  const tab = params.get("tab") ?? "overview";
  const q = useBattery(id);
  useAssistantBattery(id);

  const setTab = (t: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("tab", t);
    for (const k of ["dataset"]) if (t !== "diagnostics") next.delete(k);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  if (q.isError) {
    return (
      <Callout tone="rose" title={q.error instanceof ApiError && q.error.status === 404 ? "Battery not found" : "Could not load this battery"}>
        {q.error instanceof ApiError && q.error.status === 404 ? "It may belong to another workspace or the link is wrong." : (q.error as Error).message}
      </Callout>
    );
  }
  const b = q.data;

  return (
    <>
      <Link href="/batteries" className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-4" /> Batteries
      </Link>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {b ? (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="font-mono text-2xl font-semibold tracking-tight text-zinc-900">{b.bos_id}</h1>
                <StatusControl battery={b} />
              </div>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-500">
                <span>{label(BATTERY_TYPE_LABELS, b.battery_type)}</span>
                <span className="text-zinc-300">•</span>
                <span>{b.chemistry !== "unknown" ? b.chemistry : "Chemistry unknown"}</span>
                <span className="text-zinc-300">•</span>
                <span className="tabular">{ratings(b)}</span>
                {b.pack_configuration ? (
                  <>
                    <span className="text-zinc-300">•</span>
                    <Mono>{b.pack_configuration}</Mono>
                  </>
                ) : null}
                <span className="text-zinc-300">•</span>
                {b.customer ? (
                  <Link href={`/customers/${b.customer.id}`} className="text-zinc-700 hover:underline">
                    {b.customer.name}
                  </Link>
                ) : (
                  <span>No customer</span>
                )}
                <span className="text-zinc-300">•</span>
                <span>Received {formatDate(b.received_date)}</span>
                {b.batch ? (
                  <>
                    <span className="text-zinc-300">•</span>
                    <Link href={`/batches/${b.batch.id}`} className="hover:underline">
                      {b.batch.reference}
                    </Link>
                  </>
                ) : null}
              </p>
            </>
          ) : (
            <>
              <Skeleton className="h-8 w-56" />
              <Skeleton className="mt-2 h-4 w-96 max-w-full" />
            </>
          )}
        </div>
        {b ? (
          <div className="flex flex-wrap gap-2">
            {can("uploads.write") ? (
              <ButtonLink href={`/batteries/${b.id}?tab=files`} variant="secondary" size="sm" onClick={(e) => { e.preventDefault(); setTab("files"); }}>
                <Upload /> Upload files
              </ButtonLink>
            ) : null}
            {can("tests.write") ? (
              <ButtonLink href={`/batteries/${b.id}?tab=tests`} variant="secondary" size="sm" onClick={(e) => { e.preventDefault(); setTab("tests"); }}>
                <FilePlus2 /> Record test
              </ButtonLink>
            ) : null}
            {can("reports.draft") ? (
              <ButtonLink href={`/batteries/${b.id}?tab=reports&draft=1`} variant="secondary" size="sm">
                <FileText /> Draft report
              </ButtonLink>
            ) : null}
            {can("quotations.draft") ? (
              <ButtonLink href={`/batteries/${b.id}?tab=quotations&new=1`} variant="secondary" size="sm">
                <Receipt /> Quotation
              </ButtonLink>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mb-6 overflow-x-auto overflow-y-hidden border-b border-zinc-200 scrollbar-thin">
        <nav className="-mb-px flex min-w-max gap-5" role="tablist">
          {TABS.map((t) => {
            const count = "count" in t && b?.counts ? b.counts[t.count] : undefined;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 border-b-2 px-0.5 pb-2.5 pt-1 text-sm font-medium transition-colors",
                  active ? "border-zinc-900 text-zinc-900" : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800",
                )}
              >
                {t.label}
                {count ? (
                  <span className={cn("tabular rounded-full px-1.5 text-[11px]", active ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600")}>{count}</span>
                ) : null}
              </button>
            );
          })}
        </nav>
      </div>

      {!b ? (
        <LoadingBlock rows={6} />
      ) : tab === "files" ? (
        <FilesTab battery={b} />
      ) : tab === "diagnostics" ? (
        <DiagnosticsTab battery={b} />
      ) : tab === "tests" ? (
        <TestsTab battery={b} />
      ) : tab === "reports" ? (
        <ReportsTab battery={b} />
      ) : tab === "quotations" ? (
        <QuotationsTab battery={b} />
      ) : tab === "history" ? (
        <HistoryTab battery={b} />
      ) : (
        <OverviewTab battery={b} onNavigate={setTab} />
      )}
    </>
  );
}

export default function BatteryPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <BatteryDetail />
    </Suspense>
  );
}
