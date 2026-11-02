"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  CheckCircle2,
  Download,
  FileText,
  History,
  LayoutTemplate,
  Lock,
  MoreHorizontal,
  Plus,
  Send,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { QuoteStatusBadge } from "@/components/badges";
import { ConfirmDialog, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tooltip } from "@/components/overlay";
import { CustomerPicker } from "@/components/pickers";
import { Badge, Button, Callout, Card, CardHeader, Field, Input, LoadingBlock, Mono, Select, Textarea } from "@/components/ui";
import { api, apiUrl } from "@/lib/api";
import { cn, formatDate, formatDateTime, formatINR, label, QUOTE_STATUS_LABELS } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { CatalogueItem, Quotation, QuotationLine } from "@/lib/types";

interface EditLine extends QuotationLine {
  key: string;
  price: string; // rupees as typed
  gst: string; // percent as typed
  qty: string;
}

const toEdit = (l: QuotationLine, i: number): EditLine => ({
  ...l,
  key: l.id ?? `n${i}-${Math.random()}`,
  price: (l.unit_price_paise / 100).toFixed(2),
  gst: String(l.tax_rate_bp / 100),
  qty: String(l.quantity),
});

function amounts(qty: number, pricePaise: number, bp: number) {
  const sub = Math.round(qty * pricePaise);
  const tax = Math.round((sub * bp) / 10000);
  return { sub, tax, total: sub + tax };
}

function parseLine(l: EditLine) {
  const quantity = Number(l.qty);
  const unit_price_paise = Math.round(Number(l.price) * 100);
  const tax_rate_bp = Math.round(Number(l.gst) * 100);
  return { quantity, unit_price_paise, tax_rate_bp, valid: quantity > 0 && unit_price_paise >= 0 && tax_rate_bp >= 0 && tax_rate_bp <= 10000 && !!l.description.trim() };
}

export default function QuotationPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["quotation", id], queryFn: () => api<Quotation>(`/quotations/${id}`) });
  const catalogue = useQuery({ queryKey: ["catalogue"], queryFn: () => api<CatalogueItem[]>("/catalogue") });
  const qt = q.data;
  const [lines, setLines] = useState<EditLine[]>([]);
  const [meta, setMeta] = useState({ customer_id: null as string | null, issue_date: "", valid_until: "", notes: "", terms: "" });
  const [confirm, setConfirm] = useState<null | "sent" | "accepted" | "declined" | "void" | "approve">(null);
  const [reason, setReason] = useState("");

  const reset = (x: Quotation) => {
    setLines((x.lines ?? []).map(toEdit));
    setMeta({ customer_id: x.customer?.id ?? null, issue_date: x.issue_date ?? "", valid_until: x.valid_until ?? "", notes: x.notes ?? "", terms: x.terms ?? "" });
  };
  useEffect(() => {
    if (qt) reset(qt);
  }, [qt]);

  const editable = !!qt && qt.status === "draft" && can("quotations.draft");
  const parsed = lines.map(parseLine);
  const totals = useMemo(
    () =>
      parsed.reduce(
        (acc, p) => {
          if (!p.valid) return acc;
          const a = amounts(p.quantity, p.unit_price_paise, p.tax_rate_bp);
          return { sub: acc.sub + a.sub, tax: acc.tax + a.tax };
        },
        { sub: 0, tax: 0 },
      ),
    [parsed],
  );
  const payloadLines = lines.map((l, i) => ({
    catalogue_item_id: l.catalogue_item_id,
    description: l.description.trim(),
    quantity: parsed[i].quantity,
    unit: l.unit || "each",
    unit_price_paise: parsed[i].unit_price_paise,
    tax_rate_bp: parsed[i].tax_rate_bp,
    origin: l.origin,
    rationale: l.rationale,
  }));
  const dirty =
    !!qt &&
    (JSON.stringify(payloadLines) !==
      JSON.stringify(
        (qt.lines ?? []).map((l) => ({
          catalogue_item_id: l.catalogue_item_id,
          description: l.description,
          quantity: l.quantity,
          unit: l.unit,
          unit_price_paise: l.unit_price_paise,
          tax_rate_bp: l.tax_rate_bp,
          origin: l.origin,
          rationale: l.rationale,
        })),
      ) ||
      meta.customer_id !== (qt.customer?.id ?? null) ||
      meta.issue_date !== (qt.issue_date ?? "") ||
      meta.valid_until !== (qt.valid_until ?? "") ||
      meta.notes !== (qt.notes ?? "") ||
      meta.terms !== (qt.terms ?? ""));
  const allValid = parsed.every((p) => p.valid);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["quotation", id] });
    qc.invalidateQueries({ queryKey: ["quotations"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    if (qt) {
      qc.invalidateQueries({ queryKey: ["battery", qt.battery.id] });
      qc.invalidateQueries({ queryKey: ["battery-history", qt.battery.id] });
    }
  };
  const save = useMutation({
    mutationFn: () =>
      api<Quotation>(`/quotations/${id}`, {
        method: "PATCH",
        body: { ...meta, issue_date: meta.issue_date || null, valid_until: meta.valid_until || null, lines: payloadLines },
      }),
    onSuccess: () => {
      invalidate();
      toast.success("Quotation saved");
    },
  });
  const approve = useMutation({
    mutationFn: () => api<Quotation>(`/quotations/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      setConfirm(null);
      toast.success("Quotation approved");
    },
  });
  const setStatus = useMutation({
    mutationFn: (status: string) => api<Quotation>(`/quotations/${id}/status`, { body: { status, reason: reason || null } }),
    onSuccess: (r) => {
      invalidate();
      setConfirm(null);
      setReason("");
      toast.success(`Marked ${label(QUOTE_STATUS_LABELS, r.status).toLowerCase()}`);
    },
  });
  const revise = useMutation({
    mutationFn: () => api<Quotation>(`/quotations/${id}/revise`, { method: "POST" }),
    onSuccess: (r) => {
      invalidate();
      toast.success(`Revision ${r.revision} started`);
    },
  });

  if (q.isLoading || !qt) return <LoadingBlock rows={8} />;

  const addFromCatalogue = (itemId: string) => {
    const c = catalogue.data?.find((x) => x.id === itemId);
    if (!c) return;
    setLines([
      ...lines,
      toEdit(
        { catalogue_item_id: c.id, description: c.name, quantity: 1, unit: c.unit, unit_price_paise: c.unit_price_paise, tax_rate_bp: c.tax_rate_bp, origin: "human", rationale: null },
        lines.length,
      ),
    ]);
  };
  const update = (key: string, patch: Partial<EditLine>) => setLines(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const drafter = qt.drafted_by.startsWith("anthropic:") ? "ai" : qt.drafted_by;

  return (
    <div className={cn(dirty && editable && "pb-24")}>
      <Link href={`/batteries/${qt.battery.id}?tab=quotations`} className="mb-3 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-4" /> {qt.battery.bos_id} · Quotations
      </Link>
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight text-zinc-900">{qt.number}</h1>
            <span className="text-sm text-zinc-400">revision {qt.revision}</span>
            <QuoteStatusBadge status={qt.status} />
            {drafter === "ai" ? (
              <Badge tone="fuchsia">
                <Sparkles /> AI-suggested lines
              </Badge>
            ) : drafter === "template" ? (
              <Badge tone="zinc">
                <LayoutTemplate /> Catalogue defaults
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-zinc-500">
            {qt.customer?.name ?? "No customer"} · <Mono>{qt.battery.bos_id}</Mono>
            {qt.report ? (
              <>
                {" "}
                · based on{" "}
                <Link href={`/reports/${qt.report.id}`} className="text-brand-700 hover:underline">
                  {qt.report.report_number} v{qt.report.version}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={apiUrl(`/quotations/${qt.id}/pdf`)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[13px] font-medium text-zinc-800 shadow-card ring-1 ring-inset ring-zinc-200 hover:bg-zinc-50">
            <Download className="size-4" /> PDF
          </a>
          {qt.status === "draft" && can("quotations.approve") ? (
            <Tooltip content={dirty ? "Save your changes first" : undefined}>
              <span>
                <Button variant="brand" size="sm" disabled={dirty} onClick={() => setConfirm("approve")}>
                  <BadgeCheck /> Approve
                </Button>
              </span>
            </Tooltip>
          ) : null}
          {qt.status === "approved" ? (
            <Button variant="primary" size="sm" onClick={() => setConfirm("sent")}>
              <Send /> Mark as sent
            </Button>
          ) : null}
          {(qt.status === "approved" || qt.status === "sent") && can("quotations.approve") ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => setConfirm("accepted")}>
                <CheckCircle2 className="!text-emerald-600" /> Accepted
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setConfirm("declined")}>
                <XCircle className="!text-rose-600" /> Declined
              </Button>
            </>
          ) : null}
          {(["approved", "sent", "declined"].includes(qt.status) && can("quotations.draft")) || (qt.status !== "void" && qt.status !== "accepted" && can("quotations.approve")) ? (
            <Menu>
              <MenuTrigger asChild>
                <Button variant="secondary" size="icon" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </MenuTrigger>
              <MenuContent>
                {["approved", "sent", "declined"].includes(qt.status) ? (
                  <MenuItem onSelect={() => revise.mutate()}>
                    <History /> Start a new revision
                  </MenuItem>
                ) : null}
                {qt.status !== "void" && qt.status !== "accepted" && can("quotations.approve") ? (
                  <>
                    <MenuSeparator />
                    <MenuItem danger onSelect={() => setConfirm("void")}>
                      <Ban /> Void quotation
                    </MenuItem>
                  </>
                ) : null}
              </MenuContent>
            </Menu>
          ) : null}
        </div>
      </div>

      {qt.status === "draft" ? (
        <Callout tone="amber" className="mb-6" icon={<FileText />} title="Draft — not valid until approved">
          {can("quotations.approve") ? "Check the lines and prices, then approve." : "An owner or admin must approve it before it is sent."} Nothing is sent to the customer by BatteryOS.
        </Callout>
      ) : qt.status === "void" ? (
        <Callout tone="zinc" className="mb-6" icon={<Ban />} title="Void">
          This quotation was voided and is kept for the record.
        </Callout>
      ) : (
        <Callout tone="emerald" className="mb-6" icon={<Lock />} title={`Approved by ${qt.approved_by?.full_name ?? "—"} on ${formatDateTime(qt.approved_at)}`}>
          {qt.status === "sent" ? `Marked sent ${formatDateTime(qt.sent_at)}. ` : null}
          {qt.status === "accepted" ? `Customer accepted ${formatDateTime(qt.decided_at)}. ` : null}
          {qt.status === "declined" ? `Customer declined ${formatDateTime(qt.decided_at)}. ` : null}
          Locked. Start a new revision to change it.
        </Callout>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Line items" description="Prices come from your catalogue and can be adjusted per quotation. Totals are recalculated on the server when saved." />
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50/70 text-xs text-zinc-500">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">Description</th>
                    <th className="w-16 px-2 py-2 text-left font-medium">Qty</th>
                    <th className="w-20 px-2 py-2 text-left font-medium">Unit</th>
                    <th className="w-24 px-2 py-2 text-right font-medium">Rate (₹)</th>
                    <th className="w-16 px-2 py-2 text-right font-medium">GST %</th>
                    <th className="w-28 px-4 py-2 text-right font-medium">Amount</th>
                    {editable ? <th className="w-10" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const p = parsed[i];
                    const a = p.valid ? amounts(p.quantity, p.unit_price_paise, p.tax_rate_bp) : null;
                    return (
                      <tr key={l.key} className="border-b border-zinc-100 align-top">
                        <td className="px-4 py-2">
                          {editable ? (
                            <Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} aria-label="Description" />
                          ) : (
                            <p className="py-1.5 text-zinc-900">{l.description}</p>
                          )}
                          {l.origin !== "human" || l.rationale ? (
                            <p className="mt-1 flex items-start gap-1 text-xs text-zinc-500">
                              {l.origin === "ai" ? <Sparkles className="mt-0.5 size-3 shrink-0 text-fuchsia-600" /> : l.origin === "template" ? <LayoutTemplate className="mt-0.5 size-3 shrink-0" /> : null}
                              <span>{l.rationale ?? (l.origin === "template" ? "Catalogue default" : "")}</span>
                            </p>
                          ) : null}
                        </td>
                        <td className="px-2 py-2">
                          {editable ? <Input value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} inputMode="decimal" aria-label="Quantity" aria-invalid={!(Number(l.qty) > 0)} /> : <p className="tabular py-1.5">{l.quantity}</p>}
                        </td>
                        <td className="px-2 py-2">
                          {editable ? <Input value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} aria-label="Unit" /> : <p className="py-1.5 text-zinc-600">{l.unit}</p>}
                        </td>
                        <td className="px-2 py-2">
                          {editable ? <Input value={l.price} onChange={(e) => update(l.key, { price: e.target.value })} inputMode="decimal" className="text-right" aria-label="Rate" /> : <p className="tabular py-1.5 text-right">{formatINR(l.unit_price_paise)}</p>}
                        </td>
                        <td className="px-2 py-2">
                          {editable ? <Input value={l.gst} onChange={(e) => update(l.key, { gst: e.target.value })} inputMode="decimal" className="text-right" aria-label="GST percent" /> : <p className="tabular py-1.5 text-right">{l.tax_rate_bp / 100}%</p>}
                        </td>
                        <td className="tabular px-4 py-3.5 text-right font-medium text-zinc-900">{a ? formatINR(a.sub) : <span className="text-rose-600">Check</span>}</td>
                        {editable ? (
                          <td className="py-2 pr-2">
                            <button className="mt-1.5 rounded p-1 text-zinc-300 hover:bg-zinc-100 hover:text-rose-600" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label="Remove line">
                              <Trash2 className="size-4" />
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                  {lines.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-sm text-zinc-500">
                        No lines yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {editable ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 px-4 py-3">
                <Select value="" onChange={(e) => e.target.value && addFromCatalogue(e.target.value)} className="w-auto max-w-80" aria-label="Add from catalogue">
                  <option value="">+ Add from catalogue…</option>
                  {catalogue.data
                    ?.filter((c) => c.is_active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code} · {c.name} · {formatINR(c.unit_price_paise)}/{c.unit}
                      </option>
                    ))}
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setLines([
                      ...lines,
                      toEdit({ catalogue_item_id: null, description: "", quantity: 1, unit: "each", unit_price_paise: 0, tax_rate_bp: 1800, origin: "human", rationale: null }, lines.length),
                    ])
                  }
                >
                  <Plus /> Custom line
                </Button>
                {!catalogue.data?.length ? (
                  <Link href="/catalogue" className="text-xs text-brand-700 hover:underline">
                    Set up your catalogue
                  </Link>
                ) : null}
              </div>
            ) : null}
            <div className="flex justify-end border-t border-zinc-100 px-4 py-4">
              <dl className="w-full max-w-xs space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Subtotal</dt>
                  <dd className="tabular">{formatINR(editable ? totals.sub : qt.subtotal_paise)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-zinc-500">GST</dt>
                  <dd className="tabular">{formatINR(editable ? totals.tax : qt.tax_paise)}</dd>
                </div>
                <div className="flex justify-between border-t border-zinc-200 pt-2 text-base font-semibold text-zinc-900">
                  <dt>Total</dt>
                  <dd className="tabular">{formatINR(editable ? totals.sub + totals.tax : qt.total_paise)}</dd>
                </div>
              </dl>
            </div>
          </Card>

          <Card>
            <CardHeader title="Notes and terms" description="Printed on the quotation." />
            <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-2">
              <Field label="Notes for the customer" htmlFor="q-notes">
                {editable ? <Textarea id="q-notes" rows={4} value={meta.notes} onChange={(e) => setMeta({ ...meta, notes: e.target.value })} /> : <p className="whitespace-pre-wrap text-sm text-zinc-700">{qt.notes || "—"}</p>}
              </Field>
              <Field label="Terms" htmlFor="q-terms">
                {editable ? <Textarea id="q-terms" rows={4} value={meta.terms} onChange={(e) => setMeta({ ...meta, terms: e.target.value })} /> : <p className="whitespace-pre-wrap text-sm text-zinc-700">{qt.terms || "—"}</p>}
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <div className="space-y-4 p-4 sm:p-5">
              <Field label="Customer" htmlFor="q-customer">
                {editable ? <CustomerPicker id="q-customer" value={meta.customer_id} onChange={(v) => setMeta({ ...meta, customer_id: v })} /> : <p className="text-sm text-zinc-800">{qt.customer?.name ?? "—"}</p>}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Issue date" htmlFor="q-issue">
                  {editable ? <Input id="q-issue" type="date" value={meta.issue_date} onChange={(e) => setMeta({ ...meta, issue_date: e.target.value })} /> : <p className="text-sm">{formatDate(qt.issue_date)}</p>}
                </Field>
                <Field label="Valid until" htmlFor="q-valid">
                  {editable ? <Input id="q-valid" type="date" value={meta.valid_until} onChange={(e) => setMeta({ ...meta, valid_until: e.target.value })} /> : <p className="text-sm">{formatDate(qt.valid_until)}</p>}
                </Field>
              </div>
            </div>
          </Card>

          {qt.draft_notes ? (
            <Card className="ring-fuchsia-200">
              <CardHeader icon={<Sparkles />} title="Notes from the draft" description="Internal only — not printed." />
              <p className="whitespace-pre-wrap p-4 text-sm text-zinc-700 sm:p-5">{qt.draft_notes}</p>
            </Card>
          ) : null}

          <Card>
            <CardHeader icon={<History />} title="Revisions and status changes" />
            {qt.revisions?.length ? (
              <ul className="divide-y divide-zinc-100">
                {qt.revisions.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <div>
                      <p className="text-zinc-800">
                        Rev {r.revision} · <span className="text-zinc-500">{r.reason}</span>
                      </p>
                      <p className="text-xs text-zinc-400">{formatDateTime(r.created_at)}</p>
                    </div>
                    <span className="tabular text-xs text-zinc-600">{formatINR(r.total_paise)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="p-4 text-sm text-zinc-500">No approvals yet. Each approval and status change is snapshotted here.</p>
            )}
          </Card>
        </div>
      </div>

      {dirty && editable ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/95 backdrop-blur lg:left-60">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <span className="flex items-center gap-2 text-sm text-zinc-700">
              <Badge tone="amber" dot>
                Unsaved
              </Badge>
              {allValid ? `New total ${formatINR(totals.sub + totals.tax)}` : "Some lines need a description, a quantity above 0, and a valid rate and GST."}
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => reset(qt)}>
                Discard
              </Button>
              <Button variant="primary" disabled={!allValid} loading={save.isPending} onClick={() => save.mutate()}>
                Save quotation
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm === "approve"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Approve this quotation?"
        description={`Total ${formatINR(qt.total_paise)}. Approval records your name and locks this revision. If the battery is awaiting a quotation, its status moves to Quoted.`}
        confirmLabel="Approve"
        loading={approve.isPending}
        onConfirm={() => approve.mutate()}
      />
      <ConfirmDialog
        open={!!confirm && confirm !== "approve"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={
          confirm === "sent" ? "Mark as sent to the customer?" : confirm === "accepted" ? "Customer accepted?" : confirm === "declined" ? "Customer declined?" : "Void this quotation?"
        }
        description={
          confirm === "sent"
            ? "Records that you sent it (by email, WhatsApp or in person). BatteryOS does not send anything itself."
            : confirm === "accepted"
              ? "If allowed by the workflow, the battery's status moves to Approved."
              : confirm === "void"
                ? "It stays on record, marked void."
                : "Recorded with today's date."
        }
        confirmLabel="Confirm"
        danger={confirm === "void" || confirm === "declined"}
        loading={setStatus.isPending}
        onConfirm={() => confirm && confirm !== "approve" && setStatus.mutate(confirm)}
      >
        <Field label="Note (optional)" htmlFor="status-reason">
          <Input id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
