"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus, Search, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Dialog } from "@/components/overlay";
import { CustomerForm } from "@/components/pickers";
import { Badge, Button, Card, EmptyState, Input, LoadingBlock, PageHeader, Table, TD, TH, THead, TR } from "@/components/ui";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Customer } from "@/lib/types";

export default function CustomersPage() {
  const router = useRouter();
  const { can } = useSession();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ["customers", q], queryFn: () => api<Customer[]>("/customers", { params: { q } }), placeholderData: keepPreviousData });
  return (
    <>
      <PageHeader
        title="Customers and suppliers"
        description="Who batteries come from and who you quote for."
        actions={
          can("customers.write") ? (
            <Button variant="brand" onClick={() => setOpen(true)}>
              <Plus /> Add customer
            </Button>
          ) : null
        }
      />
      <Card>
        <div className="border-b border-zinc-100 p-3 sm:p-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, contact, phone, email" className="pl-8" />
          </div>
        </div>
        {list.isLoading ? (
          <div className="p-4"><LoadingBlock rows={5} /></div>
        ) : !list.data?.length ? (
          <EmptyState
            icon={<Users />}
            title={q ? "No matches" : "No customers yet"}
            description={q ? undefined : "Add the businesses and people who send you batteries."}
            action={!q && can("customers.write") ? <Button variant="brand" onClick={() => setOpen(true)}>Add customer</Button> : null}
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH className="hidden sm:table-cell">Contact</TH>
                <TH className="hidden md:table-cell">Phone</TH>
                <TH className="hidden lg:table-cell">Email</TH>
                <TH className="text-right">Batteries</TH>
              </tr>
            </THead>
            <tbody>
              {list.data.map((c) => (
                <TR key={c.id} className="cursor-pointer hover:bg-zinc-50/80" onClick={() => router.push(`/customers/${c.id}`)}>
                  <TD>
                    <span className="font-medium text-zinc-900">{c.name}</span>
                    {c.kind !== "customer" ? (
                      <Badge tone="zinc" className="ml-2">
                        {c.kind === "supplier" ? "Supplier" : "Customer & supplier"}
                      </Badge>
                    ) : null}
                  </TD>
                  <TD className="hidden sm:table-cell">{c.contact_name ?? "—"}</TD>
                  <TD className="hidden md:table-cell">{c.phone ?? "—"}</TD>
                  <TD className="hidden lg:table-cell">{c.email ?? "—"}</TD>
                  <TD className="tabular text-right">{c.battery_count ?? 0}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog open={open} onOpenChange={setOpen} title="New customer or supplier">
        <CustomerForm onCancel={() => setOpen(false)} onSaved={(c) => router.push(`/customers/${c.id}`)} />
      </Dialog>
    </>
  );
}
