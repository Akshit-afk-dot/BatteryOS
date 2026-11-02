"use client";

import { createContext, useContext, useEffect } from "react";

export interface AssistantState {
  open: boolean;
  setOpen: (v: boolean) => void;
  batteryId: string | null;
  setBatteryId: (id: string | null) => void;
}

export const AssistantContext = createContext<AssistantState | null>(null);

export function useAssistant() {
  const v = useContext(AssistantContext);
  if (!v) throw new Error("useAssistant outside AppShell");
  return v;
}

/** Pages call this so the assistant knows which battery the user is looking at. */
export function useAssistantBattery(batteryId: string | null | undefined) {
  const { setBatteryId } = useAssistant();
  useEffect(() => {
    setBatteryId(batteryId ?? null);
    return () => setBatteryId(null);
  }, [batteryId, setBatteryId]);
}
