"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { BatteryCharging, ChevronLeft, ChevronRight, Filter, Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { STATUS_BAR, StatusBadge } from "@/components/badges";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/overlay";
import {
  Button,
  ButtonLink,
  Card,
  Checkbox,
  EmptyState,
  Input,
  LoadingBlock,
  Mono,
  PageHeader,
  Select,
  Switch,
  Table,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { api } from "@/lib/api";
import { BATTERY_TYPE_LABELS, CHEMISTRY_LABELS, cn, formatDate, label, ratings, relativeTime, STATUS_LABELS } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Battery, Customer, Page } from "@/lib/types";

function useUrlState() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const set = (patch: Record<string, string | string[] | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      next.delete(k);
      if (Array.isArray(v)) v.forEach((x) => next.append(k, x));
      else if (v) next.set(k, v);
    }
    if (!("page" in patch)) next.delete("page");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return { params, set };
}

function BatteriesList() {
  const { meta, can } = useSession();
  const router = useRouter();
  const { params, set } = useUrlState();
  const q = params.get("q") ?? "";
  const statuses = params.getAll("status");
  const chemistry = params.get("chemistry") ?? "";
  const customerId = params.get("customer_id") ?? "";
  const includeArchived = params.get("include_archived") === "1";
  const sort = params.get("sort") ?? "created_desc";
  const page = Number(params.get("page") ?? "1");
  const [search, setSearch] = useState(q);

  useEffect(() => setSearch(q), [q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) set({ q: search || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const customers = useQuery({ queryKey: ["customers"], queryFn: () => api<Customer[]>("/customers") });
  const list = useQuery({
    queryKey: ["batteries", { q, statuses, chemistry, customerId, includeArchived, sort, page }],
    queryFn: () =>
      api<Page<Battery>>("/batteries", {
        params: {
          q,
          status: statuses,
          chemistry,
          customer_id: customerId,
          include_archived: includeArchived,
          sort,
          page,
          page_size: 25,
        },
      }),
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const filtered = !!(q || statuses.length || chemistry || customerId);

  return (
    <>
      <PageHeader
        title="Batteries"
        description="Every pack and module your workshop has registered."
        actions={
          can("batteries.write") ? (
            <ButtonLink href="/batteries/new" variant="brand">
              <Plus /> New intake
            </ButtonLink>
          ) : null
        }
      />
      <Card>
        <div className="flex flex-col gap-3 border-b border-zinc-100 p-3 sm:p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ID, serial, make, model, customer, notes" className="pl-8" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary" size="md">
                  <Filter className="!text-zinc-400" />
                  Status
                  {statuses.length ? <span className="rounded bg-zinc-900 px-1.5 text-[11px] text-white">{statuses.length}</span> : null}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-60 p-2">
                <div className="space-y-0.5">
                  {meta.battery_statuses.map((s) => (
                    <div key={s} className="rounded-md px-1.5 py-1 hover:bg-zinc-50">
                      <Checkbox
                        checked={statuses.includes(s)}
                        onChange={(on) => set({ status: on ? [...statuses, s] : statuses.filter((x) => x !== s) })}
                        label={
                          <span className="flex items-center gap-2 font-normal">
                            <span className={cn("size-2 rounded-full", STATUS_BAR[s])} />
                            {label(STATUS_LABELS, s)}
                          </span>
                        }
                      />
                    </div>
                  ))}
                </div>
                {statuses.length ? (
                  <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => set({ status: null })}>
                    Clear
                  </Button>
                ) : null}
              </PopoverContent>
            </Popover>
            <Select value={chemistry} onChange={(e) => set({ chemistry: e.target.value || null })} className="w-auto min-w-36" aria-label="Chemistry">
              <option value="">All chemistries</option>
              {meta.chemistries.map((c) => (
                <option key={c} value={c}>
                  {label(CHEMISTRY_LABELS, c)}
                </option>
              ))}
            </Select>
            <Select value={customerId} onChange={(e) => set({ customer_id: e.target.value || null })} className="w-auto min-w-40 max-w-56" aria-label="Customer">
              <option value="">All customers</option>
              {customers.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select value={sort} onChange={(e) => set({ sort: e.target.value })} className="w-auto" aria-label="Sort">
              <option value="created_desc">Newest first</option>
              <option value="created_asc">Oldest first</option>
              <option value="updated_desc">Recently updated</option>
              <option value="received_desc">Received date</option>
              <option value="bos_id">Battery ID</option>
            </Select>
            <label className="flex items-center gap-2 px-1 text-sm text-zinc-600">
              <Switch checked={includeArchived} onChange={(v) => set({ include_archived: v ? "1" : null })} />
              Archived
            </label>
          </div>
        </div>
        {filtered ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500">
            Filtered:
            {q ? <span className="rounded bg-zinc-100 px-1.5 py-0.5">“{q}”</span> : null}
            {statuses.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
            {chemistry ? <span className="rounded bg-zinc-100 px-1.5 py-0.5">{chemistry}</span> : null}
            {customerId ? <span className="rounded bg-zinc-100 px-1.5 py-0.5">{customers.data?.find((c) => c.id === customerId)?.name}</span> : null}
            <button className="ml-1 inline-flex items-center gap-0.5 text-zinc-600 hover:text-zinc-900" onClick={() => router.replace("/batteries")}>
              <X className="size-3" /> Clear all
            </button>
          </div>
        ) : null}

        {list.isLoading ? (
          <div className="p-4">
            <LoadingBlock rows={6} />
          </div>
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            icon={<BatteryCharging />}
            title={filtered ? "No batteries match these filters" : "No batteries registered yet"}
            description={filtered ? "Try a different search or clear the filters." : "Register the first pack you receive. Unknown details can be left empty and filled in later."}
            action={!filtered && can("batteries.write") ? <ButtonLink href="/batteries/new" variant="brand">Register a battery</ButtonLink> : null}
          />
        ) : (
          <div className={cn(list.isFetching && "opacity-70 transition-opacity")}>
            <Table>
              <THead>
                <tr>
                  <TH>Battery</TH>
                  <TH>Status</TH>
                  <TH className="hidden md:table-cell">Customer</TH>
                  <TH className="hidden lg:table-cell">Type</TH>
                  <TH className="hidden sm:table-cell">Specification</TH>
                  <TH className="hidden xl:table-cell">Received</TH>
                  <TH className="text-right">Updated</TH>
                </tr>
              </THead>
              <tbody>
                {data.items.map((b) => (
                  <TR key={b.id} className="cursor-pointer hover:bg-zinc-50/80" onClick={() => router.push(`/batteries/${b.id}`)}>
                    <TD>
                      <Link href={`/batteries/${b.id}`} className="block" onClick={(e) => e.stopPropagation()}>
                        <Mono className="font-semibold text-zinc-900">{b.bos_id}</Mono>
                        <div className="mt-0.5 max-w-56 truncate text-xs text-zinc-500">
                          {[b.manufacturer, b.model].filter(Boolean).join(" ") || "Make/model unknown"}
                          {b.serial_number ? ` · S/N ${b.serial_number}` : ""}
                        </div>
                      </Link>
                    </TD>
                    <TD>
                      <StatusBadge status={b.status} />
                    </TD>
                    <TD className="hidden max-w-48 truncate md:table-cell">{b.customer?.name ?? <span className="text-zinc-400">—</span>}</TD>
                    <TD className="hidden whitespace-nowrap lg:table-cell">{label(BATTERY_TYPE_LABELS, b.battery_type)}</TD>
                    <TD className="hidden sm:table-cell">
                      <span className="text-zinc-900">{b.chemistry !== "unknown" ? b.chemistry : <span className="text-zinc-400">Chem. unknown</span>}</span>
                      <span className="text-zinc-400"> · </span>
                      <span className="tabular">{ratings(b)}</span>
                    </TD>
                    <TD className="hidden whitespace-nowrap xl:table-cell">{formatDate(b.received_date)}</TD>
                    <TD className="whitespace-nowrap text-right text-xs text-zinc-500">{relativeTime(b.updated_at)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3 text-sm text-zinc-500">
              <span className="tabular">
                {(page - 1) * data.page_size + 1}–{Math.min(page * data.page_size, data.total)} of {data.total}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })} aria-label="Previous page">
                  <ChevronLeft />
                </Button>
                <span className="tabular px-2 text-xs">
                  Page {page} of {pages}
                </span>
                <Button variant="ghost" size="icon" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })} aria-label="Next page">
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

export default function BatteriesPage() {
  return (
    <Suspense fallback={<LoadingBlock rows={6} />}>
      <BatteriesList />
    </Suspense>
  );
}
