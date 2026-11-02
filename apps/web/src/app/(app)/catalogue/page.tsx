"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PackagePlus, Pencil, Plus, Tags } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Dialog } from "@/components/overlay";
import { Badge, Button, Callout, Card, Checkbox, EmptyState, Field, Input, LoadingBlock, Mono, PageHeader, Select, Table, TD, TH, THead, TR, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { CATEGORY_LABELS, cn, formatINR, label } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { CatalogueItem } from "@/lib/types";

function ItemDialog({ item, open, onOpenChange }: { item: CatalogueItem | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { meta } = useSession();
  const qc = useQueryClient();
  const [f, setF] = useState(() => ({
    code: item?.code ?? "",
    name: item?.name ?? "",
    description: item?.description ?? "",
    category: item?.category ?? "service",
    unit: item?.unit ?? "each",
    price: item ? (item.unit_price_paise / 100).toFixed(2) : "",
    gst: item ? String(item.tax_rate_bp / 100) : "18",
    is_active: item?.is_active ?? true,
    default_on_quotes: item?.default_on_quotes ?? false,
  }));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        code: f.code.trim(),
        name: f.name.trim(),
        description: f.description,
        category: f.category,
        unit: f.unit.trim() || "each",
        unit_price_paise: Math.round(Number(f.price) * 100),
        tax_rate_bp: Math.round(Number(f.gst) * 100),
        is_active: f.is_active,
        default_on_quotes: f.default_on_quotes,
      };
      return item ? api(`/catalogue/${item.id}`, { method: "PATCH", body }) : api("/catalogue", { body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["catalogue"] });
      toast.success(item ? "Item updated" : "Item added");
      onOpenChange(false);
    },
  });
  const invalid = !f.code.trim() || !f.name.trim() || f.price === "" || Number(f.price) < 0 || Number(f.gst) < 0 || Number(f.gst) > 100;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={item ? `Edit ${item.code}` : "New catalogue item"}
      description="Price changes apply to new quotation lines; existing quotations keep their prices."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={invalid} loading={save.isPending} onClick={() => save.mutate()}>
            {item ? "Save" : "Add item"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" htmlFor="ci-code" required hint="Letters, numbers, - _ .">
          <Input id="ci-code" value={f.code} onChange={set("code")} className="font-mono" placeholder="REP-CELL" />
        </Field>
        <Field label="Name" htmlFor="ci-name" required className="sm:col-span-2">
          <Input id="ci-name" value={f.name} onChange={set("name")} />
        </Field>
        <Field label="Description" htmlFor="ci-desc" className="sm:col-span-3">
          <Textarea id="ci-desc" rows={2} value={f.description} onChange={set("description")} />
        </Field>
        <Field label="Category" htmlFor="ci-cat">
          <Select id="ci-cat" value={f.category} onChange={set("category")}>
            {meta.catalogue_categories.map((c) => (
              <option key={c} value={c}>
                {label(CATEGORY_LABELS, c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Unit" htmlFor="ci-unit">
          <Input id="ci-unit" value={f.unit} onChange={set("unit")} placeholder="each, cell, hour" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rate (₹)" htmlFor="ci-price" required>
            <Input id="ci-price" inputMode="decimal" value={f.price} onChange={set("price")} />
          </Field>
          <Field label="GST %" htmlFor="ci-gst">
            <Input id="ci-gst" inputMode="decimal" value={f.gst} onChange={set("gst")} />
          </Field>
        </div>
        <div className="space-y-2 sm:col-span-3">
          <Checkbox checked={f.default_on_quotes} onChange={(v) => setF({ ...f, default_on_quotes: v })} label="Add to every new quotation" description="For items like an intake/diagnostic fee." />
          <Checkbox checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Active" description="Inactive items stay on old quotations but can't be added to new ones." />
        </div>
      </div>
    </Dialog>
  );
}

export default function CataloguePage() {
  const { can } = useSession();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["catalogue"], queryFn: () => api<CatalogueItem[]>("/catalogue") });
  const [editing, setEditing] = useState<CatalogueItem | null | "new">(null);
  const starter = useMutation({
    mutationFn: () => api<{ added: number }>("/catalogue/starter", { method: "POST" }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["catalogue"] });
      toast.success(`${r.added} example items added — review the prices`);
    },
  });
  const manage = can("catalogue.manage");
  const items = list.data ?? [];
  return (
    <>
      <PageHeader
        title="Service catalogue"
        description="Your services, parts and labour with your prices. Quotations — including AI-suggested lines — only ever use these prices."
        actions={
          manage ? (
            <Button variant="brand" onClick={() => setEditing("new")}>
              <Plus /> Add item
            </Button>
          ) : null
        }
      />
      {items.length > 0 && items.some((i) => ["DIAG-INTAKE", "DIAG-CAP", "REP-CELL"].includes(i.code)) ? (
        <Callout tone="amber" className="mb-6" title="Check the example prices">
          Items from the starter set use example prices only. Edit them to match your actual rates before quoting.
        </Callout>
      ) : null}
      <Card>
        {list.isLoading ? (
          <div className="p-4"><LoadingBlock rows={5} /></div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Tags />}
            title="Your catalogue is empty"
            description="Add your own items, or start from a set of common refurbishment services with example prices you can edit."
            action={
              manage ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="primary" onClick={() => setEditing("new")}>
                    <Plus /> Add item
                  </Button>
                  <Button loading={starter.isPending} onClick={() => starter.mutate()}>
                    <PackagePlus /> Load starter items
                  </Button>
                </div>
              ) : null
            }
          />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Item</TH>
                <TH className="hidden md:table-cell">Category</TH>
                <TH className="text-right">Rate</TH>
                <TH className="hidden text-right sm:table-cell">GST</TH>
                <TH className="hidden lg:table-cell" />
                {manage ? <TH /> : null}
              </tr>
            </THead>
            <tbody>
              {items.map((i) => (
                <TR key={i.id} className={cn(!i.is_active && "opacity-50")}>
                  <TD>
                    <div className="flex items-center gap-2">
                      <Mono className="text-zinc-500">{i.code}</Mono>
                      <span className="font-medium text-zinc-900">{i.name}</span>
                    </div>
                    {i.description ? <p className="mt-0.5 max-w-xl truncate text-xs text-zinc-500">{i.description}</p> : null}
                  </TD>
                  <TD className="hidden md:table-cell">{label(CATEGORY_LABELS, i.category)}</TD>
                  <TD className="tabular whitespace-nowrap text-right font-medium text-zinc-900">
                    {formatINR(i.unit_price_paise)} <span className="font-normal text-zinc-400">/ {i.unit}</span>
                  </TD>
                  <TD className="tabular hidden text-right sm:table-cell">{i.tax_rate_bp / 100}%</TD>
                  <TD className="hidden space-x-1 lg:table-cell">
                    {i.default_on_quotes ? <Badge tone="sky">On every quote</Badge> : null}
                    {!i.is_active ? <Badge tone="zinc">Inactive</Badge> : null}
                  </TD>
                  {manage ? (
                    <TD className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => setEditing(i)} aria-label={`Edit ${i.code}`}>
                        <Pencil />
                      </Button>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {editing ? <ItemDialog item={editing === "new" ? null : editing} open onOpenChange={(o) => !o && setEditing(null)} /> : null}
    </>
  );
}
