import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ---------------------------------------------------------------- labels

export const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  awaiting_data: "Awaiting data",
  testing: "Testing",
  review_required: "Review required",
  quoted: "Quoted",
  approved: "Approved",
  repair_in_progress: "Repair in progress",
  ready: "Ready",
  dispatched: "Dispatched",
  rejected: "Rejected",
  archived: "Archived",
};

export const BATTERY_TYPE_LABELS: Record<string, string> = {
  ev_pack: "EV pack",
  e_rickshaw: "E-rickshaw pack",
  two_wheeler: "Two-wheeler pack",
  energy_storage: "Energy storage",
  module: "Module",
  cell: "Cell",
  other: "Other",
  unknown: "Unknown type",
};

export const CHEMISTRY_LABELS: Record<string, string> = {
  LFP: "LFP (LiFePO₄)",
  NMC: "NMC",
  NCA: "NCA",
  LCO: "LCO",
  LMO: "LMO",
  LTO: "LTO",
  other: "Other",
  unknown: "Unknown",
};

export const PROVENANCE_LABELS: Record<string, string> = {
  nameplate: "Nameplate",
  datasheet: "Datasheet",
  bms_reported: "BMS reported",
  customer_reported: "Customer reported",
  technician_verified: "Technician verified",
  unverified: "Not verified",
  unknown: "Unknown",
};

export const FIELD_LABELS: Record<string, string> = {
  chemistry: "Chemistry",
  nominal_voltage_v: "Nominal voltage",
  rated_capacity_ah: "Rated capacity",
  pack_configuration: "Pack configuration",
  manufacturer: "Manufacturer",
  model: "Model",
  serial_number: "Serial number",
  bms_info: "BMS",
};

export const KIND_LABELS: Record<string, string> = {
  measured: "Measured",
  user_entered: "User-entered",
  calculated: "Calculated",
  external: "External result",
  model_estimate: "Model estimate",
  technician: "Technician observation",
  system: "System check",
};

export const TEST_TYPE_LABELS: Record<string, string> = {
  capacity_test: "Capacity test",
  internal_resistance: "Internal resistance",
  visual_inspection: "Visual inspection",
  bms_readout: "BMS readout",
  cycle_test: "Cycle test",
  insulation_test: "Insulation test",
  cell_balance_check: "Cell balance check",
  other: "Other test",
};

export const NOTE_TYPE_LABELS: Record<string, string> = {
  observation: "Observation",
  inspection: "Inspection",
  review: "Review",
  general: "General",
};

export const SERVICE_EVENT_LABELS: Record<string, string> = {
  inspection: "Inspection",
  repair: "Repair",
  replacement: "Replacement",
  maintenance: "Maintenance",
  dispatch: "Dispatch",
  warranty_claim: "Warranty claim",
  other: "Other",
};

export const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  technician: "Technician",
  staff: "Staff",
};

export const ROLE_DESCRIPTIONS: Record<string, string> = {
  owner: "Everything, including workspace settings and ownership.",
  admin: "Manage team, catalogue and settings; approve reports and quotations.",
  technician: "Record tests and inspections; draft and approve diagnostic reports.",
  staff: "Register batteries, upload files, add notes and draft quotations.",
};

export const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  approved: "Approved",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  void: "Void",
};

export const CATEGORY_LABELS: Record<string, string> = {
  diagnostic: "Diagnostic",
  repair: "Repair",
  part: "Part",
  labour: "Labour",
  service: "Service",
  other: "Other",
};

export const label = (map: Record<string, string>, key: string | null | undefined) =>
  key ? map[key] ?? key.replace(/_/g, " ") : "—";

// ---------------------------------------------------------------- numbers

export function formatNumber(v: number | null | undefined, unit?: string | null, maxDigits = 3): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const n = new Intl.NumberFormat("en-IN", { maximumFractionDigits: maxDigits }).format(v);
  return unit ? `${n} ${unit}` : n;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });

export function formatINR(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "—";
  return inr.format(paise / 100);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ratings(b: { nominal_voltage_v: number | null; rated_capacity_ah: number | null }): string {
  const parts = [];
  if (b.nominal_voltage_v) parts.push(`${formatNumber(b.nominal_voltage_v)} V`);
  if (b.rated_capacity_ah) parts.push(`${formatNumber(b.rated_capacity_ah)} Ah`);
  return parts.join(" · ") || "Ratings unknown";
}

// ---------------------------------------------------------------- dates

let _tz: string | undefined;
export function setDisplayTimeZone(tz: string | undefined) {
  _tz = tz;
}

/** Date-only values ("2026-11-03") are calendar dates and must not be time-zone shifted. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(y, m - 1, d)),
    );
  }
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: _tz }).format(
    new Date(value),
  );
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: _tz,
  }).format(new Date(value));
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "—";
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (diff < 45) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)} d ago`;
  return formatDate(value);
}

export function todayISO(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: _tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return parts; // en-CA formats as YYYY-MM-DD
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(2)} h`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}
