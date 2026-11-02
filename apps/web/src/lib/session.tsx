"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo } from "react";

import { api } from "@/lib/api";
import { setDisplayTimeZone } from "@/lib/format";
import type { Me, Meta } from "@/lib/types";

interface SessionValue {
  me: Me;
  meta: Meta;
  can: (permission: string) => boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useMeQuery() {
  return useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/auth/me"), staleTime: 60_000, retry: false });
}

export function SessionProvider({ me, meta, children }: { me: Me; meta: Meta; children: React.ReactNode }) {
  const qc = useQueryClient();
  setDisplayTimeZone(me.organization.timezone);
  const can = useCallback((p: string) => me.permissions.includes(p), [me.permissions]);
  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["me"] });
  }, [qc]);
  const value = useMemo(() => ({ me, meta, can, refresh }), [me, meta, can, refresh]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession must be used inside the signed-in app shell");
  return v;
}
