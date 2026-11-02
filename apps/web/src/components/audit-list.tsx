"use client";

import {
  ArrowRightLeft,
  BadgeCheck,
  BatteryCharging,
  FilePen,
  FileText,
  FileUp,
  FlaskConical,
  Gauge,
  KeyRound,
  NotebookPen,
  Receipt,
  Settings2,
  Table2,
  Tags,
  UserPlus,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { cn, formatDateTime, relativeTime } from "@/lib/format";
import type { AuditEvent } from "@/lib/types";

function iconFor(action: string) {
  if (action === "battery.status_changed") return <ArrowRightLeft />;
  if (action.startsWith("battery.")) return <BatteryCharging />;
  if (action.startsWith("upload.")) return <FileUp />;
  if (action.startsWith("dataset.")) return <Table2 />;
  if (action.startsWith("measurement.")) return <Gauge />;
  if (action.startsWith("test_session.")) return <FlaskConical />;
  if (action.startsWith("note.")) return <NotebookPen />;
  if (action === "report.approved" || action === "quotation.approved") return <BadgeCheck />;
  if (action.startsWith("report.")) return <FileText />;
  if (action.startsWith("quotation.")) return <Receipt />;
  if (action.startsWith("catalogue.")) return <Tags />;
  if (action.startsWith("service_event.")) return <Wrench />;
  if (action.startsWith("member.")) return <UserPlus />;
  if (action.startsWith("user.")) return <KeyRound />;
  if (action.startsWith("organization.")) return <Settings2 />;
  return <FilePen />;
}

function tone(action: string) {
  if (action.endsWith(".approved")) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (action.endsWith(".voided") || action.includes("revoked") || action.includes("declined")) return "bg-rose-50 text-rose-700 ring-rose-200";
  if (action === "battery.status_changed") return "bg-violet-50 text-violet-700 ring-violet-200";
  if (action.startsWith("report.") || action.startsWith("quotation.")) return "bg-sky-50 text-sky-700 ring-sky-200";
  return "bg-zinc-50 text-zinc-600 ring-zinc-200";
}

function Details({ details }: { details: Record<string, any> }) {
  const entries = Object.entries(details ?? {}).filter(([, v]) => v !== null && v !== undefined && !(Array.isArray(v) && !v.length));
  if (!entries.length) return null;
  const isDiff = entries.every(([, v]) => v && typeof v === "object" && "from" in v && "to" in v);
  return (
    <div className="mt-2 rounded-md bg-zinc-50 p-2.5 text-xs ring-1 ring-zinc-200">
      {isDiff ? (
        <table className="w-full">
          <tbody>
            {entries.map(([k, v]) => (
              <tr key={k} className="align-top">
                <td className="py-0.5 pr-3 font-medium text-zinc-600">{k.replace(/_/g, " ")}</td>
                <td className="py-0.5 pr-2 text-zinc-400 line-through">{fmt(v.from)}</td>
                <td className="py-0.5 text-zinc-800">{fmt(v.to)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-zinc-600 scrollbar-thin">{JSON.stringify(details, null, 2)}</pre>
      )}
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function AuditList({ events, showBattery }: { events: AuditEvent[]; showBattery?: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  return (
    <ol className="relative space-y-0">
      {events.map((e, i) => {
        const expanded = open.has(e.id);
        const hasDetails = Object.keys(e.details ?? {}).length > 0;
        return (
          <li key={e.id} className="relative flex gap-3 px-4 py-3 sm:px-5">
            {i < events.length - 1 ? <span className="absolute left-[33px] top-11 bottom-0 w-px bg-zinc-200 sm:left-[37px]" /> : null}
            <div className={cn("relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full ring-1 [&_svg]:size-3.5", tone(e.action))}>
              {iconFor(e.action)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-800">{e.summary}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-zinc-500">
                <span>{e.actor?.full_name ?? "System"}</span>
                <span title={formatDateTime(e.created_at)}>{relativeTime(e.created_at)}</span>
                <span className="font-mono text-[10.5px] text-zinc-400">{e.action}</span>
                {showBattery && e.battery_id ? (
                  <Link href={`/batteries/${e.battery_id}?tab=history`} className="text-brand-700 hover:underline">
                    battery
                  </Link>
                ) : null}
                {hasDetails ? (
                  <button
                    className="text-zinc-600 hover:text-zinc-900"
                    onClick={() =>
                      setOpen((s) => {
                        const n = new Set(s);
                        if (n.has(e.id)) n.delete(e.id);
                        else n.add(e.id);
                        return n;
                      })
                    }
                  >
                    {expanded ? "Hide details" : "Details"}
                  </button>
                ) : null}
              </p>
              {expanded ? <Details details={e.details} /> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
