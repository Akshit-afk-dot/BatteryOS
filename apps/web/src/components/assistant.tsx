"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowUp, Check, Info, NotebookPen, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/badges";
import { Sheet } from "@/components/overlay";
import { Button, Callout } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { useAssistant } from "@/lib/assistant-context";
import { cn } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Proposal } from "@/lib/types";

interface Msg {
  role: "user" | "assistant";
  content: string;
  proposals?: (Proposal & { state?: "applied" | "dismissed" })[];
  error?: boolean;
}

const SUGGESTIONS = [
  "Which batteries are waiting for data?",
  "What is still missing for the batteries in review?",
  "Summarise open quotations",
];

type ProposalWithState = Proposal & { state?: "applied" | "dismissed" };

function ProposalCard({ p, onApplied, onDismiss }: { p: ProposalWithState; onApplied: () => void; onDismiss: () => void }) {
  const qc = useQueryClient();
  const apply = useMutation({
    mutationFn: () =>
      p.type === "status_change"
        ? api(`/batteries/${p.battery_id}/status`, { body: { status: p.to, reason: p.reason, via_assistant: true } })
        : api(`/batteries/${p.battery_id}/notes`, { body: { note_type: p.note_type ?? "general", body: p.body } }),
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success(p.type === "status_change" ? `${p.bos_id} moved to ${p.to?.replace(/_/g, " ")}` : `Note added to ${p.bos_id}`);
      onApplied();
    },
  });
  const done = p.state === "applied";
  return (
    <div className={cn("rounded-lg border bg-white p-3 text-sm", done ? "border-emerald-200" : p.state === "dismissed" ? "border-zinc-200 opacity-60" : "border-fuchsia-200")}>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-fuchsia-700">
        {p.type === "status_change" ? <ArrowRight className="size-3.5" /> : <NotebookPen className="size-3.5" />}
        Proposed {p.type === "status_change" ? "status change" : "note"} ·{" "}
        <Link href={`/batteries/${p.battery_id}`} className="font-mono text-zinc-700 hover:underline">
          {p.bos_id}
        </Link>
      </div>
      {p.type === "status_change" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={p.from ?? ""} />
          <ArrowRight className="size-3.5 text-zinc-400" />
          <StatusBadge status={p.to ?? ""} />
          {p.reason ? <p className="mt-1 w-full text-xs text-zinc-600">Reason: {p.reason}</p> : null}
        </div>
      ) : (
        <p className="whitespace-pre-wrap rounded-md bg-zinc-50 p-2 text-[13px] text-zinc-700">{p.body}</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {done ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
            <Check className="size-3.5" /> Applied
          </span>
        ) : p.state === "dismissed" ? (
          <span className="text-xs text-zinc-500">Dismissed</span>
        ) : (
          <>
            <Button size="sm" variant="primary" loading={apply.isPending} onClick={() => apply.mutate()}>
              Apply
            </Button>
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
            <span className="ml-auto text-[11px] text-zinc-400">Nothing changes until you apply</span>
          </>
        )}
      </div>
    </div>
  );
}

export function AssistantSheet() {
  const { open, setOpen, batteryId } = useAssistant();
  const { me } = useSession();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = useMutation({
    meta: { silent: true },
    mutationFn: (history: Msg[]) =>
      api<{ reply: string; proposals: Proposal[] }>("/assistant/chat", {
        body: {
          messages: history.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content })),
          battery_id: batteryId,
        },
      }),
    onSuccess: (res) => setMessages((m) => [...m, { role: "assistant", content: res.reply, proposals: res.proposals }]),
    onError: (e) => setMessages((m) => [...m, { role: "assistant", content: errorMessage(e), error: true }]),
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, send.isPending]);

  const submit = (text: string) => {
    const t = text.trim();
    if (!t || send.isPending) return;
    const next = [...messages, { role: "user" as const, content: t }];
    setMessages(next);
    setInput("");
    send.mutate(next);
  };

  const updateProposal = (mi: number, pi: number, state: "applied" | "dismissed") =>
    setMessages((all) =>
      all.map((m, i) => (i === mi ? { ...m, proposals: m.proposals?.map((p, j) => (j === pi ? { ...p, state } : p)) } : m)),
    );

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      title={
        <span className="flex items-center gap-1.5">
          <Sparkles className="size-4 text-fuchsia-600" /> Workflow assistant
        </span>
      }
      description="Looks up your records. Can only propose changes — you apply them."
      width="max-w-md"
      headerActions={
        messages.length ? (
          <button className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" onClick={() => setMessages([])} aria-label="New conversation" title="New conversation">
            <RotateCcw className="size-4" />
          </button>
        ) : null
      }
    >
      <div className="flex h-full flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 scrollbar-thin">
          {!me.ai.configured ? (
            <Callout tone="amber" icon={<Sparkles />} title="The assistant is not configured on this server">
              Set <code className="rounded bg-amber-100 px-1">ANTHROPIC_API_KEY</code> for the API service to enable it. Everything else in
              BatteryOS works without it; report drafts use a deterministic template instead.
            </Callout>
          ) : null}
          {messages.length === 0 ? (
            <div className="space-y-3 pt-2">
              <p className="text-sm text-zinc-600">
                Ask about batteries, what is missing, or where work is stuck.
                {batteryId ? " I can see which battery you have open." : ""}
              </p>
              <div className="flex flex-col gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    disabled={!me.ai.configured}
                    onClick={() => submit(s)}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm text-zinc-700 hover:border-fuchsia-300 hover:bg-fuchsia-50/40 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((m, i) => (
            <div key={i} className={cn("flex flex-col gap-2", m.role === "user" ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                  m.role === "user" ? "rounded-br-md bg-zinc-900 text-white" : m.error ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200" : "rounded-bl-md bg-zinc-100 text-zinc-800",
                )}
              >
                {m.content}
              </div>
              {m.proposals?.map((p, j) => (
                <div key={j} className="w-full">
                  <ProposalCard p={p} onApplied={() => updateProposal(i, j, "applied")} onDismiss={() => updateProposal(i, j, "dismissed")} />
                </div>
              ))}
            </div>
          ))}
          {send.isPending ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="flex gap-1">
                <span className="size-1.5 animate-bounce rounded-full bg-fuchsia-400 [animation-delay:-0.2s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-fuchsia-400 [animation-delay:-0.1s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-fuchsia-400" />
              </span>
              Checking your records…
            </div>
          ) : null}
        </div>
        <form
          className="border-t border-zinc-100 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit(input);
          }}
        >
          <div className="flex items-end gap-2 rounded-xl bg-zinc-50 p-1.5 ring-1 ring-zinc-200 focus-within:ring-2 focus-within:ring-fuchsia-400">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(input);
                }
              }}
              disabled={!me.ai.configured}
              rows={1}
              placeholder={me.ai.configured ? "Ask about your batteries…" : "Assistant unavailable"}
              className="max-h-32 min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm focus:outline-none"
            />
            <Button type="submit" variant="primary" size="icon" disabled={!input.trim() || send.isPending || !me.ai.configured} aria-label="Send">
              <ArrowUp />
            </Button>
          </div>
          <p className="mt-1.5 flex items-center gap-1 px-1 text-[11px] text-zinc-400">
            <Info className="size-3" /> Never certifies safety or estimates health. Verify important answers in the record.
          </p>
        </form>
      </div>
    </Sheet>
  );
}
