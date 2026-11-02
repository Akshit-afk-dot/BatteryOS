"use client";

import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";

import { AuditList } from "@/components/audit-list";
import { Card, CardHeader, EmptyState, LoadingBlock } from "@/components/ui";
import { api } from "@/lib/api";
import type { AuditEvent, Battery } from "@/lib/types";

export function HistoryTab({ battery }: { battery: Battery }) {
  const q = useQuery({ queryKey: ["battery-history", battery.id], queryFn: () => api<AuditEvent[]>(`/batteries/${battery.id}/history`) });
  return (
    <Card>
      <CardHeader
        icon={<History />}
        title="History"
        description="Every registration, edit, upload, import, result, status change, report and quotation action — who did it and when."
      />
      {q.isLoading ? (
        <div className="p-4">
          <LoadingBlock rows={5} />
        </div>
      ) : q.data?.length ? (
        <AuditList events={q.data} />
      ) : (
        <EmptyState title="No history" />
      )}
    </Card>
  );
}
