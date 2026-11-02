"use client";

import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BatteryCharging,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  FileClock,
  Hourglass,
  Receipt,
} from "lucide-react";
import Link from "next/link";

import { QuoteStatusBadge, STATUS_BAR, StatusBadge } from "@/components/badges";
import { ButtonLink, Card, CardHeader, EmptyState, LoadingBlock, Mono, PageHeader, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { cn, formatDate, formatINR, label, ratings, relativeTime, STATUS_LABELS } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Battery, CatalogueItem, Dashboard, Member } from "@/lib/types";

function Kpi({
  label: title,
  value,
  sub,
  icon,
  href,
  tone = "zinc",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon: React.ReactNode;
  href?: string;
  tone?: "zinc" | "amber" | "violet" | "sky" | "emerald";
}) {
  const toneCls = {
    zinc: "bg-zinc-100 text-zinc-600",
    amber: "bg-amber-50 text-amber-700",
    violet: "bg-violet-50 text-violet-700",
    sky: "bg-sky-50 text-sky-700",
    emerald: "bg-emerald-50 text-emerald-700",
  }[tone];
  const body = (
    <Card className={cn("flex h-full items-start gap-3 p-4 transition-shadow", href && "hover:shadow-pop")}>
      <div className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4.5", toneCls)}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[13px] text-zinc-500">{title}</p>
        <p className="tabular mt-0.5 text-2xl font-semibold tracking-tight text-zinc-900">{value}</p>
        {sub ? <p className="mt-0.5 text-xs text-zinc-500">{sub}</p> : null}
      </div>
    </Card>
  );
  return href ? (
    <Link href={href} className="block rounded-xl focus-visible:outline-offset-4">
      {body}
    </Link>
  ) : (
    body
  );
}

function BatteryRow({ b, meta }: { b: Battery; meta?: React.ReactNode }) {
  return (
    <Link href={`/batteries/${b.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Mono className="font-medium text-zinc-900">{b.bos_id}</Mono>
          <StatusBadge status={b.status} />
        </div>
        <p className="mt-0.5 truncate text-xs text-zinc-500">
          {[b.customer?.name, ratings(b), b.chemistry !== "unknown" ? b.chemistry : null].filter(Boolean).join(" · ")}
        </p>
      </div>
      <span className="shrink-0 text-xs text-zinc-400">{meta}</span>
    </Link>
  );
}

function Onboarding({ total }: { total: number }) {
  const { me, can } = useSession();
  const catalogue = useQuery({ queryKey: ["catalogue"], queryFn: () => api<CatalogueItem[]>("/catalogue") });
  const members = useQuery({ queryKey: ["members"], queryFn: () => api<Member[]>("/organizations/current/members") });
  const steps = [
    { done: !!me.organization.address, label: "Add your business details", hint: "Address and GSTIN appear on reports and quotations.", href: "/settings" },
    { done: (catalogue.data?.length ?? 0) > 0, label: "Set up your service catalogue", hint: "Quotations use your own prices.", href: "/catalogue" },
    { done: total > 0, label: "Register your first battery", hint: "Capture what you know; unknown fields can stay empty.", href: "/batteries/new" },
    { done: (members.data?.length ?? 0) > 1, label: "Invite your team", hint: "Technicians, intake and admin staff.", href: "/settings?tab=team" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length || !can("batteries.write")) return null;
  return (
    <Card className="mb-6 overflow-hidden">
      <div className="flex flex-col gap-4 bg-gradient-to-br from-zinc-950 to-zinc-800 p-5 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-volt">Getting started</p>
          <p className="mt-1 text-lg font-semibold">Set up {me.organization.name}</p>
          <p className="mt-0.5 text-sm text-zinc-400">{doneCount} of {steps.length} done</p>
        </div>
        <div className="h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-volt transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
        </div>
      </div>
      <div className="grid divide-y divide-zinc-100 sm:grid-cols-2 sm:divide-x lg:grid-cols-4 lg:divide-y-0">
        {steps.map((s) => (
          <Link key={s.label} href={s.href} className="group flex gap-3 p-4 hover:bg-zinc-50">
            {s.done ? <CheckCircle2 className="mt-0.5 size-4.5 shrink-0 text-brand-600" /> : <Circle className="mt-0.5 size-4.5 shrink-0 text-zinc-300" />}
            <div>
              <p className={cn("text-sm font-medium", s.done ? "text-zinc-400 line-through" : "text-zinc-900")}>{s.label}</p>
              <p className="mt-0.5 text-xs text-zinc-500">{s.hint}</p>
            </div>
          </Link>
        ))}
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const { me } = useSession();
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/dashboard") });
  const d = q.data;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      <PageHeader
        eyebrow={me.organization.name}
        title={`${greeting}, ${me.user.full_name.split(" ")[0]}`}
        description="What is in the workshop and what needs attention. Every number here is counted from stored records."
      />
      {d ? <Onboarding total={d.total_batteries} /> : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {d ? (
          <>
            <Kpi
              label="Batteries in progress"
              value={d.active_batteries}
              sub={`${d.total_batteries} recorded in total`}
              icon={<BatteryCharging />}
              href="/batteries"
            />
            <Kpi label="Awaiting data" value={d.by_status.awaiting_data ?? 0} icon={<Hourglass />} tone="amber" href="/batteries?status=awaiting_data" />
            <Kpi label="Review required" value={d.by_status.review_required ?? 0} icon={<ClipboardCheck />} tone="violet" href="/batteries?status=review_required" />
            <Kpi label="Reports awaiting approval" value={d.reports_awaiting_approval} icon={<FileClock />} tone="sky" />
            <Kpi
              label="Open quotations"
              value={d.open_quotations.counts.draft + d.open_quotations.counts.approved + d.open_quotations.counts.sent}
              sub={`${formatINR(d.open_quotations.approved_or_sent_total_paise)} approved or sent`}
              icon={<Receipt />}
              tone="emerald"
              href="/quotations"
            />
          </>
        ) : (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-xl" />)
        )}
      </div>

      <Card className="mt-6">
        <CardHeader title="Batteries by status" description="Click a status to see those batteries." />
        <div className="p-4 sm:p-5">
          {d ? (
            d.total_batteries === 0 ? (
              <p className="text-sm text-zinc-500">No batteries yet.</p>
            ) : (
              <>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100">
                  {Object.entries(d.by_status)
                    .filter(([, n]) => n > 0)
                    .map(([s, n]) => (
                      <Link
                        key={s}
                        href={`/batteries?status=${s}`}
                        className={cn("h-full transition-opacity hover:opacity-80", STATUS_BAR[s])}
                        style={{ width: `${(n / d.total_batteries) * 100}%` }}
                        title={`${STATUS_LABELS[s]}: ${n}`}
                      />
                    ))}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-6">
                  {Object.entries(d.by_status).map(([s, n]) => (
                    <Link key={s} href={`/batteries?status=${s}`} className={cn("flex items-center gap-2 rounded-md py-1 text-sm hover:text-zinc-900", n ? "text-zinc-700" : "text-zinc-400")}>
                      <span className={cn("size-2 rounded-full", STATUS_BAR[s])} />
                      <span className="truncate">{label(STATUS_LABELS, s)}</span>
                      <span className="tabular ml-auto font-medium">{n}</span>
                    </Link>
                  ))}
                </div>
              </>
            )
          ) : (
            <Skeleton className="h-16" />
          )}
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Needs attention" description="Waiting longest first." />
          {!d ? (
            <div className="p-4"><LoadingBlock /></div>
          ) : d.awaiting_data.length + d.review_required.length === 0 ? (
            <EmptyState icon={<CheckCircle2 />} title="Nothing is waiting" description="No batteries are awaiting data or technician review." />
          ) : (
            <div className="divide-y divide-zinc-100">
              {[...d.review_required, ...d.awaiting_data].map((b) => (
                <BatteryRow key={b.id} b={b} meta={`waiting ${relativeTime(b.status_changed_at).replace(" ago", "")}`} />
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Open quotations"
            description="Draft, approved and sent."
            actions={
              <ButtonLink href="/quotations" variant="ghost" size="sm">
                All <ArrowRight />
              </ButtonLink>
            }
          />
          {!d ? (
            <div className="p-4"><LoadingBlock /></div>
          ) : d.open_quotations.items.length === 0 ? (
            <EmptyState icon={<Receipt />} title="No open quotations" description="Quotations are drafted from a battery's approved report." />
          ) : (
            <div className="divide-y divide-zinc-100">
              {d.open_quotations.items.map((qt) => (
                <Link key={qt.id} href={`/quotations/${qt.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Mono className="font-medium text-zinc-900">{qt.number}</Mono>
                      <QuoteStatusBadge status={qt.status} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-zinc-500">
                      {qt.battery.bos_id} · {qt.customer?.name ?? "No customer"}
                    </p>
                  </div>
                  <span className="tabular shrink-0 text-sm font-medium text-zinc-900">{formatINR(qt.total_paise)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Recently received" />
          {!d ? (
            <div className="p-4"><LoadingBlock /></div>
          ) : d.recently_received.length === 0 ? (
            <EmptyState
              icon={<BatteryCharging />}
              title="No batteries yet"
              description="Register a battery to start its record."
              action={<ButtonLink href="/batteries/new" variant="brand">Register a battery</ButtonLink>}
            />
          ) : (
            <div className="divide-y divide-zinc-100">
              {d.recently_received.map((b) => (
                <BatteryRow key={b.id} b={b} meta={formatDate(b.received_date)} />
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Recently updated" />
          {!d ? (
            <div className="p-4"><LoadingBlock /></div>
          ) : d.recently_updated.length === 0 ? (
            <EmptyState title="No activity yet" />
          ) : (
            <div className="divide-y divide-zinc-100">
              {d.recently_updated.map((b) => (
                <BatteryRow key={b.id} b={b} meta={relativeTime(b.updated_at)} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
