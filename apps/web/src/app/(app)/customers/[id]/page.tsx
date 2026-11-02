"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BatteryCharging, Mail, MapPin, Pencil, Phone, Plus, Receipt, User } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { QuoteStatusBadge, StatusBadge } from "@/components/badges";
import { Dialog } from "@/components/overlay";
import { CustomerForm } from "@/components/pickers";
import { Button, ButtonLink, Card, CardHeader, EmptyState, LoadingBlock, Mono, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, formatINR, ratings } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Customer } from "@/lib/types";

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ["customer", id], queryFn: () => api<Customer>(`/customers/${id}`) });
  const c = q.data;
  if (!c) return <LoadingBlock rows={6} />;
  const contact = [
    c.contact_name ? { icon: User, v: c.contact_name } : null,
    c.phone ? { icon: Phone, v: c.phone } : null,
    c.email ? { icon: Mail, v: c.email } : null,
    c.address ? { icon: MapPin, v: c.address } : null,
  ].filter(Boolean) as { icon: typeof User; v: string }[];
  return (
    <>
      <Link href="/customers" className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-4" /> Customers
      </Link>
      <PageHeader
        title={c.name}
        description={c.kind === "supplier" ? "Supplier" : c.kind === "both" ? "Customer and supplier" : "Customer"}
        actions={
          <>
            {can("customers.write") ? (
              <Button onClick={() => setEditing(true)}>
                <Pencil /> Edit
              </Button>
            ) : null}
            {can("batteries.write") ? (
              <ButtonLink href={`/batteries/new?customer_id=${c.id}`} variant="brand">
                <Plus /> New intake
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Contact" />
            <div className="space-y-2.5 p-4 text-sm sm:p-5">
              {contact.length ? (
                contact.map((x, i) => (
                  <p key={i} className="flex items-start gap-2 text-zinc-700">
                    <x.icon className="mt-0.5 size-4 shrink-0 text-zinc-400" />
                    <span className="whitespace-pre-wrap">{x.v}</span>
                  </p>
                ))
              ) : (
                <p className="text-zinc-400">No contact details.</p>
              )}
              {c.tax_id ? <p className="pt-1 text-xs text-zinc-500">GSTIN / tax ID: {c.tax_id}</p> : null}
              {c.notes ? <p className="whitespace-pre-wrap border-t border-zinc-100 pt-3 text-zinc-600">{c.notes}</p> : null}
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader icon={<BatteryCharging />} title={`Batteries (${c.batteries?.length ?? 0})`} />
            {c.batteries?.length ? (
              <ul className="divide-y divide-zinc-100">
                {c.batteries.map((b) => (
                  <li key={b.id}>
                    <Link href={`/batteries/${b.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 sm:px-5">
                      <Mono className="font-semibold text-zinc-900">{b.bos_id}</Mono>
                      <StatusBadge status={b.status} />
                      <span className="hidden truncate text-sm text-zinc-500 sm:inline">
                        {b.chemistry !== "unknown" ? `${b.chemistry} · ` : ""}
                        {ratings(b)}
                      </span>
                      <span className="ml-auto text-xs text-zinc-400">{formatDate(b.received_date)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState className="py-8" title="No batteries from this customer yet" />
            )}
          </Card>
          <Card>
            <CardHeader icon={<Receipt />} title="Quotations" />
            {c.quotations?.length ? (
              <ul className="divide-y divide-zinc-100">
                {c.quotations.map((x) => (
                  <li key={x.id}>
                    <Link href={`/quotations/${x.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-50 sm:px-5">
                      <Mono className="font-semibold text-zinc-900">{x.number}</Mono>
                      <QuoteStatusBadge status={x.status} />
                      <span className="text-xs text-zinc-500">{x.battery.bos_id}</span>
                      <span className="tabular ml-auto text-sm font-medium">{formatINR(x.total_paise)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState className="py-8" title="No quotations yet" />
            )}
          </Card>
        </div>
      </div>
      <Dialog open={editing} onOpenChange={setEditing} title={`Edit ${c.name}`}>
        <CustomerForm initial={c} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
      </Dialog>
    </>
  );
}
