"use client";

import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button, Callout, Field, Input } from "@/components/ui";
import { api, errorMessage } from "@/lib/api";

function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useMutation({
    meta: { silent: true },
    mutationFn: () => api("/auth/login", { body: { email, password } }),
    onSuccess: () => router.replace(safeNext(params.get("next"))),
  });
  return (
    <>
      <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">Sign in</h2>
      <p className="mt-1 text-sm text-zinc-500">Welcome back. Sign in to your workspace.</p>
      <form
        className="mt-8 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate();
        }}
      >
        {login.isError ? <Callout tone="rose">{errorMessage(login.error)}</Callout> : null}
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={login.isPending}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-500">
        New to BatteryOS?{" "}
        <Link href="/signup" className="font-medium text-brand-700 hover:underline">
          Create a workspace
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
