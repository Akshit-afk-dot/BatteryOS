"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  ImageIcon,
  LineChart,
  Lock,
  RefreshCw,
  TableProperties,
  UploadCloud,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Dialog, Tooltip } from "@/components/overlay";
import { Badge, ButtonLink, Callout, Card, CardHeader, EmptyState, Field, Input, LoadingBlock, Mono, Select } from "@/components/ui";
import { api, apiUrl } from "@/lib/api";
import { cn, formatBytes, formatDateTime, label, TEST_TYPE_LABELS } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Battery, TestSession, Upload } from "@/lib/types";

const ACCEPT = ".csv,.txt,.tsv,.jpg,.jpeg,.png,.webp,.pdf";

interface Pending {
  file: File;
  progress: number;
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
  result?: Upload;
}

function uploadWithProgress(url: string, form: FormData, onProgress: (p: number) => void): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("x-batteryos-client", "web");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: any = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new Error(typeof body?.detail === "string" ? body.detail : `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(form);
  });
}

function Uploader({ battery, sessions }: { battery: Battery; sessions: TestSession[] }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [queue, setQueue] = useState<Pending[]>([]);
  const [description, setDescription] = useState("");
  const [equipment, setEquipment] = useState("");
  const [sessionId, setSessionId] = useState("");
  const busy = queue.some((p) => p.status === "uploading" || p.status === "queued");

  const start = async (files: File[]) => {
    if (!files.length) return;
    const items: Pending[] = files.map((f) => ({ file: f, progress: 0, status: "queued" }));
    setQueue((q) => [...q.filter((p) => p.status !== "done"), ...items]);
    for (const item of items) {
      setQueue((q) => q.map((p) => (p === item ? { ...p, status: "uploading" } : p)));
      const form = new FormData();
      form.append("file", item.file);
      if (description.trim()) form.append("description", description.trim());
      if (equipment.trim()) form.append("test_metadata", JSON.stringify({ equipment: equipment.trim() }));
      if (sessionId) form.append("test_session_id", sessionId);
      try {
        const res = await uploadWithProgress(apiUrl(`/batteries/${battery.id}/uploads`), form, (p) =>
          setQueue((q) => q.map((x) => (x.file === item.file ? { ...x, progress: p } : x))),
        );
        setQueue((q) => q.map((x) => (x.file === item.file ? { ...x, status: "done", progress: 1, result: res } : x)));
      } catch (e) {
        setQueue((q) => q.map((x) => (x.file === item.file ? { ...x, status: "error", error: (e as Error).message } : x)));
      }
    }
    qc.invalidateQueries({ queryKey: ["uploads", battery.id] });
    qc.invalidateQueries({ queryKey: ["battery", battery.id] });
    qc.invalidateQueries({ queryKey: ["battery-history", battery.id] });
  };

  return (
    <Card>
      <CardHeader title="Add files" description="CSV exports from a BMS or tester, photos of the pack and label, and PDF documents. Up to 25 MB each." />
      <div className="space-y-4 p-4 sm:p-5">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            start(Array.from(e.dataTransfer.files));
          }}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
            drag ? "border-brand-500 bg-brand-50/60" : "border-zinc-200 bg-zinc-50/50 hover:border-zinc-300 hover:bg-zinc-50",
          )}
        >
          <UploadCloud className={cn("size-8", drag ? "text-brand-600" : "text-zinc-400")} />
          <p className="mt-2 text-sm font-medium text-zinc-800">Drop files here or click to choose</p>
          <p className="mt-0.5 text-xs text-zinc-500">CSV, TXT, TSV · JPG, PNG, WebP · PDF</p>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              start(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Description (optional)" htmlFor="up-desc">
            <Input id="up-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. BMS log after full charge" />
          </Field>
          <Field label="Equipment (optional)" htmlFor="up-eq">
            <Input id="up-eq" value={equipment} onChange={(e) => setEquipment(e.target.value)} placeholder="Tester or BMS tool used" />
          </Field>
          <Field label="Link to test session" htmlFor="up-ts">
            <Select id="up-ts" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              <option value="">None</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {label(TEST_TYPE_LABELS, s.test_type)} · {s.test_date ?? ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {queue.length ? (
          <ul className="space-y-2">
            {queue.map((p, i) => (
              <li key={i} className="rounded-lg bg-white p-2.5 ring-1 ring-zinc-200">
                <div className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-800">{p.file.name}</span>
                  <span className="text-xs text-zinc-400">{formatBytes(p.file.size)}</span>
                  {p.status === "done" ? (
                    p.result?.kind === "csv" ? (
                      <ButtonLink size="sm" variant="primary" href={`/batteries/${battery.id}/import/${p.result.id}`}>
                        Preview &amp; import
                      </ButtonLink>
                    ) : (
                      <CheckCircle2 className="size-4 text-brand-600" />
                    )
                  ) : p.status === "error" ? (
                    <button onClick={() => setQueue((q) => q.filter((x) => x !== p))} aria-label="Dismiss">
                      <X className="size-4 text-zinc-400" />
                    </button>
                  ) : null}
                </div>
                {p.status === "error" ? (
                  <p className="mt-1 text-xs text-rose-700">{p.error}</p>
                ) : p.status !== "done" ? (
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-100">
                    <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${Math.max(4, p.progress * 100)}%` }} />
                  </div>
                ) : null}
              </li>
            ))}
            {!busy ? (
              <button className="text-xs text-zinc-500 hover:text-zinc-800" onClick={() => setQueue([])}>
                Clear list
              </button>
            ) : null}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

function Fingerprinted({ u }: { u: Upload }) {
  const [state, setState] = useState<"idle" | "checking" | "ok" | "bad">("idle");
  return (
    <Tooltip content={`SHA-256 ${u.sha256}. Click to re-check the stored file against this fingerprint.`}>
      <button
        className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-700"
        onClick={async () => {
          setState("checking");
          try {
            const r = await api<{ verified: boolean }>(`/uploads/${u.id}/verify`);
            setState(r.verified ? "ok" : "bad");
            if (r.verified) toast.success("Stored file matches its original fingerprint");
            else toast.error("Stored file does NOT match its fingerprint");
          } catch {
            setState("idle");
          }
        }}
      >
        <Fingerprint className={cn("size-3.5", state === "ok" && "text-brand-600", state === "bad" && "text-rose-600")} />
        <Mono>{u.sha256.slice(0, 10)}</Mono>
        {state === "ok" ? <span className="text-brand-700">verified</span> : null}
      </button>
    </Tooltip>
  );
}

export function FilesTab({ battery }: { battery: Battery }) {
  const { can } = useSession();
  const uploads = useQuery({ queryKey: ["uploads", battery.id], queryFn: () => api<Upload[]>(`/batteries/${battery.id}/uploads`) });
  const sessions = useQuery({ queryKey: ["test-sessions", battery.id], queryFn: () => api<TestSession[]>(`/batteries/${battery.id}/test-sessions`) });
  const [photo, setPhoto] = useState<Upload | null>(null);
  const all = uploads.data ?? [];
  const csvs = all.filter((u) => u.kind === "csv");
  const photos = all.filter((u) => u.kind === "photo");
  const docs = all.filter((u) => u.kind === "document");

  return (
    <div className="space-y-6">
      {can("uploads.write") ? <Uploader battery={battery} sessions={sessions.data ?? []} /> : null}
      <Callout tone="zinc" icon={<Lock />}>
        Original files are stored exactly as uploaded and cannot be edited or deleted. Each has a SHA-256 fingerprint so you can prove it
        has not changed. Imports create a separate normalized copy.
      </Callout>

      <Card>
        <CardHeader icon={<FileSpreadsheet />} title="Data files" description="Preview, map columns and validate before importing." />
        {uploads.isLoading ? (
          <div className="p-4"><LoadingBlock /></div>
        ) : csvs.length === 0 ? (
          <EmptyState className="py-8" icon={<TableProperties />} title="No data files yet" description="Upload a BMS export or test-equipment CSV." />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {csvs.map((u) => {
              const active = u.datasets?.find((d) => d.status === "active");
              return (
                <li key={u.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                      <FileSpreadsheet className="size-4.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900">{u.original_filename}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                        <span>{formatBytes(u.size_bytes)}</span>
                        <span>
                          {u.uploaded_by?.full_name} · {formatDateTime(u.uploaded_at)}
                        </span>
                        <Fingerprinted u={u} />
                      </div>
                      {u.description || Object.keys(u.test_metadata ?? {}).length ? (
                        <p className="mt-1 text-xs text-zinc-600">
                          {u.description}
                          {u.test_metadata?.equipment ? ` · Equipment: ${u.test_metadata.equipment}` : ""}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
                    {active ? (
                      <Badge tone="emerald">
                        <CheckCircle2 /> Imported · {active.imported_rows.toLocaleString("en-IN")} rows
                      </Badge>
                    ) : (
                      <Badge tone="amber">Not imported</Badge>
                    )}
                    {active ? (
                      <ButtonLink size="sm" variant="secondary" href={`/batteries/${battery.id}?tab=diagnostics&dataset=${active.id}`}>
                        <LineChart /> View data
                      </ButtonLink>
                    ) : null}
                    {can("data.import") ? (
                      <ButtonLink size="sm" variant={active ? "ghost" : "primary"} href={`/batteries/${battery.id}/import/${u.id}`}>
                        {active ? <RefreshCw /> : null}
                        {active ? "Re-import" : "Preview & import"}
                      </ButtonLink>
                    ) : null}
                    <a className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" href={apiUrl(`/uploads/${u.id}/download`)} aria-label="Download original">
                      <Download className="size-4" />
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<ImageIcon />} title="Photos" />
          {photos.length === 0 ? (
            <EmptyState className="py-8" title="No photos" description="Photograph the pack, label and any damage at intake." />
          ) : (
            <div className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4">
              {photos.map((u) => (
                <button key={u.id} onClick={() => setPhoto(u)} className="group relative aspect-square overflow-hidden rounded-lg bg-zinc-100 ring-1 ring-zinc-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={apiUrl(`/uploads/${u.id}/download`, { inline: true })} alt={u.description ?? u.original_filename} className="size-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader icon={<FileText />} title="Documents" />
          {docs.length === 0 ? (
            <EmptyState className="py-8" title="No documents" description="Lab reports, datasheets, invoices (PDF)." />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {docs.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                  <FileText className="size-4 text-rose-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900">{u.original_filename}</p>
                    <p className="text-xs text-zinc-500">
                      {formatBytes(u.size_bytes)} · {formatDateTime(u.uploaded_at)}
                      {u.description ? ` · ${u.description}` : ""}
                    </p>
                  </div>
                  <a className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" href={apiUrl(`/uploads/${u.id}/download`, { inline: true })} target="_blank" rel="noreferrer" aria-label="Open">
                    <ExternalLink className="size-4" />
                  </a>
                  <a className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" href={apiUrl(`/uploads/${u.id}/download`)} aria-label="Download">
                    <Download className="size-4" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Dialog open={!!photo} onOpenChange={(o) => !o && setPhoto(null)} title={photo?.original_filename ?? ""} description={photo?.description ?? undefined} size="xl">
        {photo ? (
          <div className="space-y-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={apiUrl(`/uploads/${photo.id}/download`, { inline: true })} alt={photo.description ?? photo.original_filename} className="mx-auto max-h-[65vh] rounded-lg" />
            <div className="flex items-center justify-between text-xs text-zinc-500">
              <span>
                Uploaded by {photo.uploaded_by?.full_name} · {formatDateTime(photo.uploaded_at)}
              </span>
              <a href={apiUrl(`/uploads/${photo.id}/download`)} className="inline-flex items-center gap-1 text-zinc-700 hover:underline">
                <Download className="size-3.5" /> Original
              </a>
            </div>
          </div>
        ) : null}
      </Dialog>
      {uploads.isError ? <Callout tone="rose">Could not load files.</Callout> : null}
    </div>
  );
}
