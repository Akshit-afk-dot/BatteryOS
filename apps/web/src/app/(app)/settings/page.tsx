"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Copy, KeyRound, Link2, UserPlus, Users } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";

import { RoleBadge } from "@/components/badges";
import { Badge, Button, Callout, Card, CardHeader, Field, Input, LoadingBlock, PageHeader, Segmented, Select, Table, TD, TH, THead, TR, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDate, label, ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Invitation, Member, Organization } from "@/lib/types";

const ZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Asia/Dhaka", "Asia/Kathmandu", "Europe/London", "Europe/Berlin", "America/New_York", "UTC"];

function WorkspaceSettings() {
  const { me, can, refresh } = useSession();
  const qc = useQueryClient();
  const org = me.organization;
  const [f, setF] = useState({
    name: org.name,
    legal_name: org.legal_name ?? "",
    address: org.address ?? "",
    phone: org.phone ?? "",
    email: org.email ?? "",
    tax_id: org.tax_id ?? "",
    battery_id_prefix: org.battery_id_prefix,
    timezone: org.timezone,
    quotation_validity_days: String(org.quotation_validity_days),
    quotation_terms: org.quotation_terms ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () =>
      api<Organization>("/organizations/current", {
        method: "PATCH",
        body: { ...f, battery_id_prefix: f.battery_id_prefix.toUpperCase(), quotation_validity_days: Number(f.quotation_validity_days) },
      }),
    onSuccess: async () => {
      await refresh();
      qc.invalidateQueries({ queryKey: ["meta"] });
      toast.success("Workspace settings saved");
    },
  });
  const disabled = !can("org.update");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="space-y-6"
    >
      {disabled ? <Callout tone="zinc">Only owners and admins can change workspace settings.</Callout> : null}
      <Card>
        <CardHeader icon={<Building2 />} title="Business details" description="Printed on diagnostic reports and quotations." />
        <fieldset disabled={disabled} className="grid gap-4 p-4 sm:grid-cols-2 sm:p-5">
          <Field label="Workspace name" htmlFor="s-name" required>
            <Input id="s-name" value={f.name} onChange={set("name")} />
          </Field>
          <Field label="Legal name" htmlFor="s-legal" hint="If different from the workspace name.">
            <Input id="s-legal" value={f.legal_name} onChange={set("legal_name")} />
          </Field>
          <Field label="Address" htmlFor="s-address" className="sm:col-span-2">
            <Textarea id="s-address" rows={2} value={f.address} onChange={set("address")} />
          </Field>
          <Field label="Phone" htmlFor="s-phone">
            <Input id="s-phone" value={f.phone} onChange={set("phone")} />
          </Field>
          <Field label="Email" htmlFor="s-email">
            <Input id="s-email" type="email" value={f.email} onChange={set("email")} />
          </Field>
          <Field label="GSTIN / tax ID" htmlFor="s-tax">
            <Input id="s-tax" value={f.tax_id} onChange={set("tax_id")} />
          </Field>
          <Field label="Time zone" htmlFor="s-tz" hint="Used for dates on records and documents.">
            <Select id="s-tz" value={f.timezone} onChange={set("timezone")}>
              {(ZONES.includes(f.timezone) ? ZONES : [f.timezone, ...ZONES]).map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </Select>
          </Field>
        </fieldset>
      </Card>
      <Card>
        <CardHeader title="Numbering and quotations" />
        <fieldset disabled={disabled} className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
          <Field label="Battery ID prefix" htmlFor="s-prefix" hint={`Next IDs look like ${f.battery_id_prefix.toUpperCase() || "BOS"}-26-00042. Existing IDs don't change.`}>
            <Input id="s-prefix" value={f.battery_id_prefix} onChange={set("battery_id_prefix")} maxLength={8} className="font-mono uppercase" />
          </Field>
          <Field label="Quotations valid for (days)" htmlFor="s-valid">
            <Input id="s-valid" type="number" min={1} max={365} value={f.quotation_validity_days} onChange={set("quotation_validity_days")} />
          </Field>
          <Field label="Default quotation terms" htmlFor="s-terms" className="sm:col-span-3">
            <Textarea id="s-terms" rows={3} value={f.quotation_terms} onChange={set("quotation_terms")} />
          </Field>
        </fieldset>
      </Card>
      {!disabled ? (
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save settings
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function InviteForm() {
  const { me } = useSession();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const invite = useMutation({
    mutationFn: () => api<Invitation>("/organizations/current/invitations", { body: { email, role } }),
    onSuccess: (inv) => {
      qc.invalidateQueries({ queryKey: ["invitations"] });
      setLink(`${window.location.origin}/invite/${inv.token}`);
      setCopied(false);
      setEmail("");
    },
  });
  const roles = me.role === "owner" ? ["staff", "technician", "admin"] : ["staff", "technician"];
  return (
    <Card>
      <CardHeader icon={<UserPlus />} title="Invite someone" description="They get a one-time link to join this workspace." />
      <div className="space-y-4 p-4 sm:p-5">
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate();
          }}
        >
          <Field label="Email" htmlFor="inv-email">
            <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@business.com" />
          </Field>
          <Field label="Role" htmlFor="inv-role">
            <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {label(ROLE_LABELS, r)}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="primary" loading={invite.isPending}>
            Create invite link
          </Button>
        </form>
        <p className="text-xs text-zinc-500">{ROLE_DESCRIPTIONS[role]}</p>
        {link ? (
          <Callout tone="emerald" icon={<Link2 />} title="Invite link created">
            <p>Send this link to them yourself (BatteryOS does not send emails yet). It works once and expires in 7 days. It will not be shown again.</p>
            <div className="mt-2 flex gap-2">
              <Input readOnly value={link} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <Button
                onClick={async () => {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                }}
              >
                {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          </Callout>
        ) : null}
      </div>
    </Card>
  );
}

function TeamSettings() {
  const { me, can } = useSession();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ["members"], queryFn: () => api<Member[]>("/organizations/current/members") });
  const invites = useQuery({ queryKey: ["invitations"], queryFn: () => api<Invitation[]>("/organizations/current/invitations"), enabled: can("members.manage") });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<Member> }) => api(`/organizations/current/members/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members"] });
      toast.success("Access updated");
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/organizations/current/invitations/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invitations"] }),
  });
  const manage = can("members.manage");
  const pending = (invites.data ?? []).filter((i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date());
  return (
    <div className="space-y-6">
      {manage ? <InviteForm /> : null}
      <Card>
        <CardHeader icon={<Users />} title="Team" description="Roles control what each person can do. The server enforces them on every request." />
        {members.isLoading ? (
          <div className="p-4"><LoadingBlock /></div>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Person</TH>
                <TH>Role</TH>
                <TH className="hidden sm:table-cell">Joined</TH>
                <TH>Access</TH>
              </tr>
            </THead>
            <tbody>
              {members.data?.map((m) => {
                const self = m.user_id === me.user.id;
                const canEdit = manage && !self && (m.role !== "owner" || me.role === "owner");
                return (
                  <TR key={m.id} className={!m.is_active ? "opacity-60" : undefined}>
                    <TD>
                      <p className="font-medium text-zinc-900">
                        {m.full_name} {self ? <span className="text-xs font-normal text-zinc-400">(you)</span> : null}
                      </p>
                      <p className="text-xs text-zinc-500">{m.email}</p>
                    </TD>
                    <TD>
                      {canEdit ? (
                        <Select value={m.role} onChange={(e) => update.mutate({ id: m.id, body: { role: e.target.value as Member["role"] } })} className="h-8 w-36">
                          {(me.role === "owner" ? ["owner", "admin", "technician", "staff"] : ["admin", "technician", "staff"]).map((r) => (
                            <option key={r} value={r} disabled={r === "admin" && me.role !== "owner" && m.role !== "admin"}>
                              {label(ROLE_LABELS, r)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <RoleBadge role={m.role} />
                      )}
                    </TD>
                    <TD className="hidden whitespace-nowrap text-xs text-zinc-500 sm:table-cell">{formatDate(m.created_at)}</TD>
                    <TD>
                      {canEdit ? (
                        <Button size="sm" variant={m.is_active ? "danger-ghost" : "secondary"} onClick={() => update.mutate({ id: m.id, body: { is_active: !m.is_active } })}>
                          {m.is_active ? "Deactivate" : "Reactivate"}
                        </Button>
                      ) : (
                        <Badge tone={m.is_active ? "emerald" : "zinc"}>{m.is_active ? "Active" : "Inactive"}</Badge>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      {manage && pending.length ? (
        <Card>
          <CardHeader title="Pending invitations" />
          <ul className="divide-y divide-zinc-100">
            {pending.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-zinc-900">{i.email}</p>
                  <p className="text-xs text-zinc-500">
                    {label(ROLE_LABELS, i.role)} · invited by {i.invited_by?.full_name} · expires {formatDate(i.expires_at)}
                  </p>
                </div>
                <Button size="sm" variant="danger-ghost" loading={revoke.isPending && revoke.variables === i.id} onClick={() => revoke.mutate(i.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function AccountSettings() {
  const { me, refresh } = useSession();
  const [name, setName] = useState(me.user.full_name);
  const [pw, setPw] = useState({ current_password: "", new_password: "", confirm: "" });
  const profile = useMutation({
    mutationFn: () => api("/auth/profile", { method: "PATCH", body: { full_name: name } }),
    onSuccess: async () => {
      await refresh();
      toast.success("Name updated");
    },
  });
  const password = useMutation({
    mutationFn: () => api("/auth/password", { body: { current_password: pw.current_password, new_password: pw.new_password } }),
    onSuccess: () => {
      setPw({ current_password: "", new_password: "", confirm: "" });
      toast.success("Password changed. Other sessions were signed out.");
    },
  });
  const mismatch = pw.confirm.length > 0 && pw.confirm !== pw.new_password;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Your profile" />
        <form
          className="space-y-4 p-4 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            profile.mutate();
          }}
        >
          <Field label="Full name" htmlFor="acc-name">
            <Input id="acc-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Email" htmlFor="acc-email" hint="Your sign-in email.">
            <Input id="acc-email" value={me.user.email} disabled />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={profile.isPending} disabled={!name.trim() || name === me.user.full_name}>
              Save
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <CardHeader icon={<KeyRound />} title="Change password" description="Signs you out everywhere else." />
        <form
          className="space-y-4 p-4 sm:p-5"
          onSubmit={(e) => {
            e.preventDefault();
            password.mutate();
          }}
        >
          <Field label="Current password" htmlFor="pw-cur">
            <Input id="pw-cur" type="password" autoComplete="current-password" required value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} />
          </Field>
          <Field label="New password" htmlFor="pw-new" hint="At least 10 characters.">
            <Input id="pw-new" type="password" autoComplete="new-password" required minLength={10} value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} />
          </Field>
          <Field label="Confirm new password" htmlFor="pw-confirm" error={mismatch ? "Passwords don't match." : null}>
            <Input id="pw-confirm" type="password" autoComplete="new-password" required value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={password.isPending} disabled={mismatch || pw.new_password.length < 10}>
              Change password
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function SettingsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<"workspace" | "team" | "account">((params.get("tab") as any) ?? "workspace");
  useEffect(() => {
    const t = params.get("tab");
    if (t === "workspace" || t === "team" || t === "account") setTab(t);
  }, [params]);
  return (
    <>
      <PageHeader title="Settings" />
      <Segmented
        className="mb-6"
        value={tab}
        onChange={(t) => {
          setTab(t);
          router.replace(`${pathname}?tab=${t}`, { scroll: false });
        }}
        options={[
          { value: "workspace", label: "Workspace" },
          { value: "team", label: "Team" },
          { value: "account", label: "Your account" },
        ]}
      />
      {tab === "workspace" ? <WorkspaceSettings /> : tab === "team" ? <TeamSettings /> : <AccountSettings />}
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <SettingsInner />
    </Suspense>
  );
}
