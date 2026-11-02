"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, Callout, Field, Input } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ organization_name: "", full_name: "", email: "", password: "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });
  const signup = useMutation({
    meta: { silent: true },
    mutationFn: () => api("/auth/signup", { body: form }),
    onSuccess: () => router.replace("/dashboard?welcome=1"),
  });
  const tooShort = form.password.length > 0 && form.password.length < 10;
  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">Create your workspace</h2>
      <p className="mt-1 text-sm text-zinc-500">One workspace per business. You can invite your team next.</p>
      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          signup.mutate();
        }}
      >
        {signup.isError ? <Callout tone="rose">{errorMessage(signup.error)}</Callout> : null}
        <Field label="Business name" htmlFor="org">
          <Input id="org" required minLength={2} value={form.organization_name} onChange={set("organization_name")} placeholder="e.g. Sharma Battery Works" autoFocus />
        </Field>
        <Field label="Your name" htmlFor="name">
          <Input id="name" required autoComplete="name" value={form.full_name} onChange={set("full_name")} />
        </Field>
        <Field label="Work email" htmlFor="email">
          <Input id="email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters." error={tooShort ? "At least 10 characters." : null}>
          <Input id="password" type="password" required minLength={10} autoComplete="new-password" value={form.password} onChange={set("password")} />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={signup.isPending}>
          Create workspace
        </Button>
        <p className="text-xs leading-relaxed text-zinc-500">
          You will be the workspace owner. Records in your workspace are never visible to other businesses.
        </p>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
