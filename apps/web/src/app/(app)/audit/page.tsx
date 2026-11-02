"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { useState } from "react";

import { AuditList } from "@/components/audit-list";
import { Button, Callout, Card, EmptyState, LoadingBlock, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { AuditEvent } from "@/lib/types";

const FILTERS = [
  ["", "Everything"],
  ["battery.", "Batteries"],
  ["battery.status_changed", "Status changes"],
  ["upload.", "Uploads"],
  ["dataset.", "Imports"],
  ["measurement.", "Results"],
  ["note.", "Notes"],
  ["report.", "Reports"],
  ["quotation.", "Quotations"],
  ["catalogue.", "Catalogue"],
  ["member.", "Team"],
  ["user.", "Sign-ins and passwords"],
  ["organization.", "Workspace settings"],
];

export default function AuditPage() {
  const { can } = useSession();
  const [action, setAction] = useState("");
  const q = useInfiniteQuery({
    queryKey: ["audit", action],
    queryFn: ({ pageParam }) => api<{ items: AuditEvent[]; next_before: string | null }>("/audit", { params: { action, before: pageParam, limit: 50 } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_before ?? undefined,
    enabled: can("audit.view"),
  });
  if (!can("audit.view")) return <Callout tone="amber">Only owners and admins can view the audit log.</Callout>;
  const events = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Important actions across the workspace: who did what, when, with before and after values. Entries cannot be edited."
        actions={
          <Select value={action} onChange={(e) => setAction(e.target.value)} className="w-auto" aria-label="Filter">
            {FILTERS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        }
      />
      <Card>
        {q.isLoading ? (
          <div className="p-4"><LoadingBlock rows={8} /></div>
        ) : events.length === 0 ? (
          <EmptyState icon={<History />} title="Nothing recorded for this filter" />
        ) : (
          <>
            <AuditList events={events} showBattery />
            {q.hasNextPage ? (
              <div className="border-t border-zinc-100 p-3 text-center">
                <Button variant="ghost" loading={q.isFetchingNextPage} onClick={() => q.fetchNextPage()}>
                  Load older entries
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
