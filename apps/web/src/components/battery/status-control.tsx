"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { STATUS_BAR, StatusBadge } from "@/components/badges";
import { Dialog, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from "@/components/overlay";
import { Button, Field, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { cn, label, STATUS_LABELS } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Battery } from "@/lib/types";

export function StatusControl({ battery }: { battery: Battery }) {
  const { meta, can } = useSession();
  const qc = useQueryClient();
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const allowed = battery.allowed_transitions ?? [];
  const needsReason = target ? meta.statuses_requiring_reason.includes(target) : false;

  const change = useMutation({
    mutationFn: () => api<Battery>(`/batteries/${battery.id}/status`, { body: { status: target, reason: reason || null } }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["battery", battery.id] });
      qc.invalidateQueries({ queryKey: ["battery-history", battery.id] });
      qc.invalidateQueries({ queryKey: ["batteries"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(`Status changed to ${label(STATUS_LABELS, b.status)}`);
      setTarget(null);
      setReason("");
    },
  });

  if (!can("batteries.write") || allowed.length === 0) return <StatusBadge status={battery.status} className="text-xs" />;

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button className="group inline-flex items-center gap-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600">
            <StatusBadge status={battery.status} className="py-1 text-xs" />
            <ChevronDown className="size-3.5 text-zinc-400 group-hover:text-zinc-700" />
          </button>
        </MenuTrigger>
        <MenuContent align="start" className="w-60">
          <MenuLabel>Move to</MenuLabel>
          {allowed.map((s) => (
            <MenuItem
              key={s}
              onSelect={() => {
                setTarget(s);
                if (!meta.statuses_requiring_reason.includes(s)) setReason("");
              }}
            >
              <span className={cn("size-2 rounded-full", STATUS_BAR[s])} />
              {label(STATUS_LABELS, s)}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
      <Dialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Change status"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              variant={target === "rejected" ? "danger" : "primary"}
              loading={change.isPending}
              disabled={needsReason && !reason.trim()}
              onClick={() => change.mutate()}
            >
              Change status
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <StatusBadge status={battery.status} />
            <ArrowRight className="size-4 text-zinc-400" />
            {target ? <StatusBadge status={target} /> : null}
          </div>
          <Field
            label={needsReason ? "Reason" : "Reason (optional)"}
            htmlFor="status-reason"
            required={needsReason}
            hint={target === "rejected" ? "Record why. A rejection is a business decision made by your staff." : "Saved in the battery's history."}
          >
            <Textarea id="status-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
