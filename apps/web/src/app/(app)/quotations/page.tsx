"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Receipt, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { QuoteStatusBadge } from "@/components/badges";
import { Card, EmptyState, Input, LoadingBlock, Mono, PageHeader, Segmented, Table, TD, TH, THead, TR } from "@/components/ui";
import { api } from "@/lib/api";
import { cn, formatDate, formatINR, relativeTime } from "@/lib/format";
import type { Quotation } from "@/lib/types";

const FILTERS = [
  { value: "open", label: "Open", statuses: ["draft", "approved", "sent"] },
  { value: "draft", label: "Draft", statuses: ["draft"] },
  { value: "approved", label: "Approved", statuses: ["approved"] },
  { value: "sent", label: "Sent", statuses: ["sent"] },
  { value: "accepted", label: "Accepted", statuses: ["accepted"] },
  { value: "declined", label: "Declined", statuses: ["declined"] },
  { value: "all", label: "All", statuses: [] as string[] },
] as const;

export default function QuotationsPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("open");
  const [q, setQ] = useState("");
  const statuses = FILTERS.find((f) => f.value === filter)!.statuses;
  const list = useQuery({
    queryKey: ["quotations", { filter, q }],
    queryFn: () => api<Quotation[]>("/quotations", { params: { status: [...statuses], q } }),
    placeholderData: keepPreviousData,
  });
  const items = list.data ?? [];
  const total = items.reduce((s, x) => s + (x.status !== "void" ? x.total_paise : 0), 0);
  return (
    <>
      <PageHeader title="Quotations" description="Start a quotation from a battery's page so it is tied to that battery and its approved report." />
      <Card>
        <div className="flex flex-col gap-3 border-b border-zinc-100 p-3 sm:p-4 lg:flex-row lg:items-center lg:justify-between">
          <Segmented value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
          <div className="relative w-full lg:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, battery, customer" className="pl-8" />
          </div>
        </div>
        {list.isLoading ? (
          <div className="p-4"><LoadingBlock rows={5} /></div>
        ) : items.length === 0 ? (
          <EmptyState icon={<Receipt />} title="No quotations here" description="Open a battery and choose New quotation." />
        ) : (
          <div className={cn(list.isFetching && "opacity-70")}>
            <Table>
              <THead>
                <tr>
                  <TH>Quotation</TH>
                  <TH>Status</TH>
                  <TH className="hidden sm:table-cell">Battery</TH>
                  <TH className="hidden md:table-cell">Customer</TH>
                  <TH className="hidden lg:table-cell">Valid until</TH>
                  <TH className="text-right">Total</TH>
                  <TH className="hidden text-right xl:table-cell">Updated</TH>
                </tr>
              </THead>
              <tbody>
                {items.map((x) => (
                  <TR key={x.id} className="cursor-pointer hover:bg-zinc-50/80" onClick={() => router.push(`/quotations/${x.id}`)}>
                    <TD>
                      <Link href={`/quotations/${x.id}`} onClick={(e) => e.stopPropagation()}>
                        <Mono className="font-semibold text-zinc-900">{x.number}</Mono>
                        <span className="ml-1.5 text-xs text-zinc-400">rev {x.revision}</span>
                      </Link>
                    </TD>
                    <TD>
                      <QuoteStatusBadge status={x.status} />
                    </TD>
                    <TD className="hidden sm:table-cell">
                      <Mono>{x.battery.bos_id}</Mono>
                    </TD>
                    <TD className="hidden max-w-56 truncate md:table-cell">{x.customer?.name ?? "—"}</TD>
                    <TD className="hidden whitespace-nowrap lg:table-cell">{formatDate(x.valid_until)}</TD>
                    <TD className="tabular whitespace-nowrap text-right font-medium text-zinc-900">{formatINR(x.total_paise)}</TD>
                    <TD className="hidden whitespace-nowrap text-right text-xs text-zinc-500 xl:table-cell">{relativeTime(x.updated_at)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
            <div className="flex justify-end border-t border-zinc-100 px-4 py-3 text-sm text-zinc-500">
              {items.length} quotation{items.length === 1 ? "" : "s"} · <span className="tabular ml-1 font-medium text-zinc-800">{formatINR(total)}</span>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}
