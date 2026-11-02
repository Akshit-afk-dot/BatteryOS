"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { RoleBadge } from "@/components/badges";
import { Button, Callout, Field, Input, LoadingBlock } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";
import { formatDate, ROLE_DESCRIPTIONS } from "@/lib/format";

interface InviteInfo {
  organization_name: string;
  email: string;
  role: string;
  valid: boolean;
  problem: string | null;
  existing_user: boolean;
  expires_at: string;
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const info = useQuery({ queryKey: ["invite", token], queryFn: () => api<InviteInfo>(`/invitations/${token}`), retry: false });
  const accept = useMutation({
    meta: { silent: true },
    mutationFn: () => api(`/invitations/${token}/accept`, { body: { full_name: name || null, password } }),
    onSuccess: () => router.replace("/dashboard"),
  });

  if (info.isLoading) return <LoadingBlock rows={4} />;
  if (info.isError || !info.data) {
    return (
      <Callout tone="rose" title="Invitation not found">
        {errorMessage(info.error)} Ask the person who invited you for a new link.
      </Callout>
    );
  }
  const inv = info.data;
  return (
    <>
      <div className="mb-6 flex size-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100">
        <MailCheck className="size-5" />
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">Join {inv.organization_name}</h2>
      <p className="mt-1 text-sm text-zinc-500">
        Invitation for <span className="font-medium text-zinc-700">{inv.email}</span>
      </p>
      <div className="mt-4 flex items-start gap-2 rounded-lg bg-zinc-50 p-3 ring-1 ring-zinc-200">
        <RoleBadge role={inv.role} />
        <p className="text-xs text-zinc-600">{ROLE_DESCRIPTIONS[inv.role]}</p>
      </div>
      {!inv.valid ? (
        <Callout tone="amber" className="mt-6" title="This invitation can no longer be used">
          {inv.problem}
        </Callout>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            accept.mutate();
          }}
        >
          {accept.isError ? <Callout tone="rose">{errorMessage(accept.error)}</Callout> : null}
          {inv.existing_user ? (
            <p className="text-sm text-zinc-600">You already have a BatteryOS account. Enter its password to add this workspace.</p>
          ) : (
            <Field label="Your name" htmlFor="name">
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
            </Field>
          )}
          <Field
            label={inv.existing_user ? "Password" : "Choose a password"}
            htmlFor="password"
            hint={inv.existing_user ? undefined : "At least 10 characters."}
          >
            <Input
              id="password"
              type="password"
              required
              minLength={inv.existing_user ? 1 : 10}
              autoComplete={inv.existing_user ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={accept.isPending}>
            Accept and join
          </Button>
          <p className="text-xs text-zinc-500">Link expires {formatDate(inv.expires_at)}.</p>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-zinc-500">
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
