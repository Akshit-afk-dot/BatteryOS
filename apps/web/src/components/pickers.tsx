"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Dialog } from "@/components/overlay";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Batch, Customer } from "@/lib/types";

const NEW = "__new__";

export function CustomerForm({ initial, onSaved, onCancel }: { initial?: Partial<Customer>; onSaved: (c: Customer) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    kind: initial?.kind ?? "customer",
    contact_name: initial?.contact_name ?? "",
    phone: initial?.phone ?? "",
    email: initial?.email ?? "",
    address: initial?.address ?? "",
    tax_id: initial?.tax_id ?? "",
    notes: initial?.notes ?? "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () =>
      initial?.id ? api<Customer>(`/customers/${initial.id}`, { method: "PATCH", body: form }) : api<Customer>("/customers", { body: form }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["customer", c.id] });
      toast.success(initial?.id ? "Customer updated" : `Customer “${c.name}” added`);
      onSaved(c);
    },
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        save.mutate();
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
        <Field label="Name" htmlFor="c-name" required>
          <Input id="c-name" required value={form.name} onChange={set("name")} autoFocus placeholder="Business or person" />
        </Field>
        <Field label="Relationship" htmlFor="c-kind">
          <Select id="c-kind" value={form.kind} onChange={set("kind")}>
            <option value="customer">Customer</option>
            <option value="supplier">Supplier</option>
            <option value="both">Customer &amp; supplier</option>
          </Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Contact person" htmlFor="c-contact">
          <Input id="c-contact" value={form.contact_name} onChange={set("contact_name")} />
        </Field>
        <Field label="Phone" htmlFor="c-phone">
          <Input id="c-phone" value={form.phone} onChange={set("phone")} inputMode="tel" />
        </Field>
        <Field label="Email" htmlFor="c-email">
          <Input id="c-email" type="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="GSTIN / tax ID" htmlFor="c-tax">
          <Input id="c-tax" value={form.tax_id} onChange={set("tax_id")} />
        </Field>
      </div>
      <Field label="Address" htmlFor="c-address">
        <Textarea id="c-address" rows={2} value={form.address} onChange={set("address")} />
      </Field>
      <Field label="Notes" htmlFor="c-notes">
        <Textarea id="c-notes" rows={2} value={form.notes} onChange={set("notes")} />
      </Field>
      <div className="flex justify-end gap-2 border-t border-zinc-100 pt-4">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          {initial?.id ? "Save changes" : "Add customer"}
        </Button>
      </div>
    </form>
  );
}

export function CustomerPicker({ value, onChange, id }: { value: string | null; onChange: (id: string | null) => void; id?: string }) {
  const customers = useQuery({ queryKey: ["customers"], queryFn: () => api<Customer[]>("/customers") });
  const [open, setOpen] = useState(false);
  return (
    <>
      <Select
        id={id}
        value={value ?? ""}
        onChange={(e) => (e.target.value === NEW ? setOpen(true) : onChange(e.target.value || null))}
      >
        <option value="">Not specified</option>
        {customers.data?.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value={NEW}>+ Add a new customer…</option>
      </Select>
      <Dialog open={open} onOpenChange={setOpen} title="New customer or supplier" size="md">
        <CustomerForm
          onCancel={() => setOpen(false)}
          onSaved={(c) => {
            onChange(c.id);
            setOpen(false);
          }}
        />
      </Dialog>
    </>
  );
}

export function BatchPicker({ value, onChange, id, customerId }: { value: string | null; onChange: (id: string | null) => void; id?: string; customerId?: string | null }) {
  const qc = useQueryClient();
  const batches = useQuery({ queryKey: ["batches"], queryFn: () => api<Batch[]>("/batches") });
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const create = useMutation({
    mutationFn: () => api<Batch>("/batches", { body: { reference, description, customer_id: customerId ?? null } }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ["batches"] });
      onChange(b.id);
      setOpen(false);
      setDescription("");
      setReference("");
      toast.success(`Batch ${b.reference} created`);
    },
  });
  return (
    <>
      <Select id={id} value={value ?? ""} onChange={(e) => (e.target.value === NEW ? setOpen(true) : onChange(e.target.value || null))}>
        <option value="">No batch</option>
        {batches.data?.map((b) => (
          <option key={b.id} value={b.id}>
            {b.reference}
            {b.customer ? ` · ${b.customer.name}` : ""}
            {b.received_date ? ` · ${formatDate(b.received_date)}` : ""}
          </option>
        ))}
        <option value={NEW}>+ Start a new batch…</option>
      </Select>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="New batch"
        description="Group batteries that arrived together, e.g. a fleet consignment."
        size="sm"
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
        <div className="space-y-4">
          <Field label="Reference" htmlFor="batch-ref" hint="Leave empty to number it automatically.">
            <Input id="batch-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="BATCH-26-001" />
          </Field>
          <Field label="Description" htmlFor="batch-desc">
            <Textarea id="batch-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="40 × 48 V packs from fleet operator" />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
