"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Dialog } from "@/components/overlay";
import { CustomerPicker } from "@/components/pickers";
import { Button, Card, EmptyState, Field, Input, LoadingBlock, Mono, PageHeader, Table, TD, TH, THead, TR, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, todayISO } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Batch } from "@/lib/types";

export default function BatchesPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useSession();
  const list = useQuery({ queryKey: ["batches"], queryFn: () => api<Batch[]>("/batches") });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ reference: "", customer_id: null as string | null, received_date: todayISO(), description: "" });
  const create = useMutation({
    mutationFn: () => api<Batch>("/batches", { body: form }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["batches"] });
      toast.success(`Batch ${b.reference} created`);
      router.push(`/batches/${b.id}`);
    },
  });
  return (
    <>
      <PageHeader
        title="Batches"
        description="Group batteries that arrived together — for example 40 packs from one fleet — and register them in one go."
        actions={
          can("batteries.write") ? (
            <Button variant="brand" onClick={() => setOpen(true)}>
              <Plus /> New batch
            </Button>
          ) : null
        }
      />
      <Card>
        {list.isLoading ? (
          <div className="p-4"><LoadingBlock rows={4} /></div>
        ) : !list.data?.length ? (
          <EmptyState icon={<Boxes />} title="No batches yet" description="Batches are optional. Use them when a consignment arrives together." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Reference</TH>
                <TH className="hidden sm:table-cell">Customer</TH>
                <TH className="hidden md:table-cell">Description</TH>
                <TH>Received</TH>
                <TH className="text-right">Batteries</TH>
              </tr>
            </THead>
            <tbody>
              {list.data.map((b) => (
                <TR key={b.id} className="cursor-pointer hover:bg-zinc-50/80" onClick={() => router.push(`/batches/${b.id}`)}>
                  <TD>
                    <Mono className="font-semibold text-zinc-900">{b.reference}</Mono>
                  </TD>
                  <TD className="hidden sm:table-cell">{b.customer?.name ?? "—"}</TD>
                  <TD className="hidden max-w-80 truncate md:table-cell">{b.description ?? "—"}</TD>
                  <TD className="whitespace-nowrap">{formatDate(b.received_date)}</TD>
                  <TD className="tabular text-right">{b.battery_count ?? 0}</TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="New batch"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
              Create batch
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Reference" htmlFor="b-ref" hint="Empty = numbered automatically">
            <Input id="b-ref" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
          </Field>
          <Field label="Received on" htmlFor="b-date">
            <Input id="b-date" type="date" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} />
          </Field>
          <Field label="Customer / supplier" htmlFor="b-cust" className="sm:col-span-2">
            <CustomerPicker id="b-cust" value={form.customer_id} onChange={(v) => setForm({ ...form, customer_id: v })} />
          </Field>
          <Field label="Description" htmlFor="b-desc" className="sm:col-span-2">
            <Textarea id="b-desc" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="40 × 48 V packs from fleet operator" />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
