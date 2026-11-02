"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BatteryCharging,
  Boxes,
  Check,
  ChevronsUpDown,
  History,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu as MenuIcon,
  Plus,
  Receipt,
  Search,
  Settings,
  Sparkles,
  Tags,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AssistantSheet } from "@/components/assistant";
import { Logo } from "@/components/logo";
import { Dialog, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Sheet } from "@/components/overlay";
import { Button, ButtonLink, Field, Input } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { AssistantContext, useAssistant } from "@/lib/assistant-context";
import { cn, initials, label, ROLE_LABELS } from "@/lib/format";
import { SessionProvider, useMeQuery, useSession } from "@/lib/session";
import type { Meta } from "@/lib/types";

// ---------------------------------------------------------------- navigation

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/batteries", label: "Batteries", icon: BatteryCharging },
  { href: "/batches", label: "Batches", icon: Boxes },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/quotations", label: "Quotations", icon: Receipt },
  { href: "/catalogue", label: "Service catalogue", icon: Tags },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can } = useSession();
  const items = [
    ...NAV,
    ...(can("audit.view") ? [{ href: "/audit", label: "Audit log", icon: History }] : []),
    { href: "/settings", label: "Settings", icon: Settings },
  ];
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium transition-colors",
              active ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100",
            )}
          >
            {active ? <span className="absolute -left-3 top-1.5 bottom-1.5 w-1 rounded-r bg-volt" /> : null}
            <Icon className={cn("size-4", active ? "text-volt" : "text-zinc-500 group-hover:text-zinc-300")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function WorkspaceSwitcher() {
  const { me } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  // A full reload guarantees no cached records from the previous workspace survive.
  const switchOrg = useMutation({
    mutationFn: (organization_id: string) => api("/auth/switch-organization", { body: { organization_id } }),
    onSuccess: () => {
      qc.clear();
      window.location.href = "/dashboard";
    },
  });
  const create = useMutation({
    mutationFn: () => api("/organizations", { body: { name } }),
    onSuccess: () => {
      toast.success("Workspace created");
      qc.clear();
      window.location.href = "/dashboard";
    },
  });
  return (
    <>
      <Menu>
        <MenuTrigger className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-volt">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-xs font-semibold text-zinc-200 ring-1 ring-white/10">
            {initials(me.organization.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-zinc-100">{me.organization.name}</div>
            <div className="text-[11px] text-zinc-500">{label(ROLE_LABELS, me.role)}</div>
          </div>
          <ChevronsUpDown className="size-4 text-zinc-500" />
        </MenuTrigger>
        <MenuContent align="start" className="w-64">
          <MenuLabel>Workspaces</MenuLabel>
          {me.memberships.map((m) => (
            <MenuItem
              key={m.organization_id}
              onSelect={() => m.organization_id !== me.organization.id && switchOrg.mutate(m.organization_id)}
            >
              <span className="flex size-6 items-center justify-center rounded bg-zinc-100 text-[10px] font-semibold text-zinc-600">
                {initials(m.organization_name)}
              </span>
              <span className="flex-1 truncate">{m.organization_name}</span>
              {m.organization_id === me.organization.id ? <Check className="!text-brand-600" /> : null}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem onSelect={() => setCreating(true)}>
            <Plus />
            Create another workspace
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Create a workspace"
        description="A separate workspace keeps another business's records completely apart. You will be its owner."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={create.isPending} disabled={name.trim().length < 2} onClick={() => create.mutate()}>
              Create workspace
            </Button>
          </>
        }
      >
        <Field label="Business name" htmlFor="ws-name">
          <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sharma Battery Works" autoFocus />
        </Field>
      </Dialog>
    </>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col bg-zinc-950 px-3 py-4">
      <Link href="/dashboard" onClick={onNavigate} className="mb-5 px-2">
        <Logo dark />
      </Link>
      <div className="mb-4">
        <WorkspaceSwitcher />
      </div>
      <NavLinks onNavigate={onNavigate} />
      <div className="mt-auto rounded-lg border border-white/5 bg-white/[0.03] p-3 text-[11.5px] leading-relaxed text-zinc-500">
        BatteryOS keeps records and drafts documents. Safety decisions and final conclusions stay with your qualified staff.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- top bar

function UserMenu() {
  const { me } = useSession();
  const router = useRouter();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSettled: () => {
      qc.clear();
      router.push("/login");
    },
  });
  return (
    <Menu>
      <MenuTrigger
        className="flex size-8 items-center justify-center rounded-full bg-brand-700 text-xs font-semibold text-white ring-2 ring-white focus:outline-none focus-visible:ring-brand-600"
        aria-label="Account menu"
      >
        {initials(me.user.full_name)}
      </MenuTrigger>
      <MenuContent className="w-60">
        <div className="px-2 py-1.5">
          <div className="truncate text-sm font-medium text-zinc-900">{me.user.full_name}</div>
          <div className="truncate text-xs text-zinc-500">{me.user.email}</div>
        </div>
        <MenuSeparator />
        <MenuItem onSelect={() => router.push("/settings?tab=account")}>
          <KeyRound />
          Account &amp; password
        </MenuItem>
        <MenuItem onSelect={() => router.push("/settings")}>
          <Settings />
          Workspace settings
        </MenuItem>
        <MenuSeparator />
        <MenuItem onSelect={() => logout.mutate()} danger>
          <LogOut />
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function GlobalSearch() {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      className="relative w-full max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/batteries?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search batteries by ID, serial, customer…"
        className="h-9 w-full rounded-lg bg-zinc-100/80 pl-8 pr-14 text-sm text-zinc-900 placeholder:text-zinc-400 ring-1 ring-inset ring-transparent focus:bg-white focus:outline-none focus:ring-zinc-300"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 sm:block">
        Ctrl K
      </kbd>
    </form>
  );
}

function Topbar({ onOpenNav }: { onOpenNav: () => void }) {
  const { setOpen } = useAssistant();
  const { can } = useSession();
  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button className="-ml-1 rounded-md p-1.5 text-zinc-600 hover:bg-zinc-200/60 lg:hidden" onClick={onOpenNav} aria-label="Open navigation">
          <MenuIcon className="size-5" />
        </button>
        <GlobalSearch />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)} className="hidden sm:inline-flex">
            <Sparkles className="!text-fuchsia-600" />
            Assistant
          </Button>
          <Button variant="secondary" size="icon" onClick={() => setOpen(true)} className="sm:hidden" aria-label="Open assistant">
            <Sparkles className="!text-fuchsia-600" />
          </Button>
          {can("batteries.write") ? (
            <ButtonLink href="/batteries/new" variant="brand" size="sm">
              <Plus />
              <span className="hidden sm:inline">New intake</span>
            </ButtonLink>
          ) : null}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- shell

function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-sm text-zinc-500">
        <div className="size-8 animate-spin rounded-full border-2 border-zinc-200 border-t-brand-600" />
        Loading workspace…
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const meQ = useMeQuery();
  const metaQ = useQuery({ queryKey: ["meta", meQ.data?.organization.id], queryFn: () => api<Meta>("/meta"), enabled: !!meQ.data, staleTime: Infinity });
  const [navOpen, setNavOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [batteryId, setBatteryId] = useState<string | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const unauthenticated = meQ.error instanceof ApiError && meQ.error.status === 401;

  useEffect(() => {
    if (unauthenticated) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, router, pathname]);

  if (unauthenticated) return <FullScreenLoader />;
  if (meQ.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6 text-center text-sm text-zinc-600">
        <div>
          <p className="font-medium text-zinc-900">Could not load your workspace.</p>
          <p className="mt-1">{(meQ.error as Error).message}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="primary" loading={meQ.isFetching} onClick={() => meQ.refetch()}>
              Try again
            </Button>
            <ButtonLink href="/login" variant="ghost">
              Go to sign in
            </ButtonLink>
          </div>
        </div>
      </div>
    );
  }
  if (!meQ.data || !metaQ.data) return <FullScreenLoader />;

  return (
    <SessionProvider me={meQ.data} meta={metaQ.data}>
      <AssistantContext.Provider value={{ open: assistantOpen, setOpen: setAssistantOpen, batteryId, setBatteryId }}>
        <div className="flex min-h-dvh">
          <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 lg:block">
            <SidebarContent />
          </aside>
          <Sheet open={navOpen} onOpenChange={setNavOpen} title="Navigation" side="left" width="max-w-64">
            <SidebarContent onNavigate={() => setNavOpen(false)} />
          </Sheet>
          <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
            <Topbar onOpenNav={() => setNavOpen(true)} />
            <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
          </div>
          <AssistantSheet />
        </div>
      </AssistantContext.Provider>
    </SessionProvider>
  );
}
