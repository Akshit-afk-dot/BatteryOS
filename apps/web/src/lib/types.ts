// Shapes returned by the BatteryOS API (see services/api/app/serializers.py).

export type Role = "owner" | "admin" | "technician" | "staff";

export interface UserBrief {
  id: string;
  full_name: string;
  email: string;
}

export interface Organization {
  id: string;
  name: string;
  legal_name: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  tax_id: string | null;
  currency: string;
  timezone: string;
  battery_id_prefix: string;
  quotation_terms: string | null;
  quotation_validity_days: number;
  created_at: string;
}

export interface Me {
  user: UserBrief;
  organization: Organization;
  role: Role;
  permissions: string[];
  memberships: { organization_id: string; organization_name: string; role: Role }[];
  ai: { configured: boolean; model: string | null };
}

export interface Member {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
  created_at: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  invited_by: UserBrief | null;
  token?: string;
}

export interface Meta {
  battery_statuses: string[];
  status_transitions: Record<string, string[]>;
  statuses_requiring_reason: string[];
  battery_types: string[];
  chemistries: string[];
  provenance_sources: string[];
  provenance_fields: string[];
  measurement_kinds: string[];
  measurement_names: Record<string, { label: string; unit: string }>;
  test_types: string[];
  note_types: string[];
  inspection_items: { key: string; label: string }[];
  service_event_types: string[];
  catalogue_categories: string[];
  csv_fields: Record<string, { label: string; units: string[]; multi: boolean }>;
  roles: Role[];
}

export interface Ref {
  id: string;
  name: string;
}

export interface Customer {
  id: string;
  name: string;
  kind: "customer" | "supplier" | "both";
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  battery_count?: number;
  batteries?: Battery[];
  quotations?: Quotation[];
}

export interface Batch {
  id: string;
  reference: string;
  customer: Ref | null;
  received_date: string | null;
  description: string | null;
  created_at: string;
  battery_count?: number;
  batteries?: Battery[];
  by_status?: Record<string, number>;
}

export interface CompletenessItem {
  key: string;
  label: string;
  done: boolean;
  hint: string;
}

export interface Battery {
  id: string;
  bos_id: string;
  status: string;
  status_changed_at: string;
  customer: Ref | null;
  batch: { id: string; reference: string } | null;
  received_date: string | null;
  battery_type: string;
  chemistry: string;
  nominal_voltage_v: number | null;
  rated_capacity_ah: number | null;
  pack_configuration: string | null;
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  created_at: string;
  updated_at: string;
  // detail only
  bms_info?: string | null;
  intake_condition?: string | null;
  notes?: string | null;
  warranty_expires_on?: string | null;
  provenance?: Record<string, string>;
  allowed_transitions?: string[];
  counts?: Record<string, number>;
  completeness?: CompletenessItem[];
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface Upload {
  id: string;
  battery_id: string;
  kind: "csv" | "photo" | "document";
  original_filename: string;
  content_type: string;
  size_bytes: number;
  sha256: string;
  description: string | null;
  test_metadata: Record<string, string | number | boolean | null>;
  test_session_id: string | null;
  uploaded_by: UserBrief | null;
  uploaded_at: string;
  datasets?: { id: string; status: string; imported_at: string; imported_rows: number }[];
}

export interface Issue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  column?: string;
  field?: string;
  count?: number;
  rows?: number[];
  detail?: Record<string, unknown>;
}

export interface MappingEntry {
  column: string;
  field: string;
  unit: string;
  unit_source: "header" | "user" | "assumed";
}

export interface ColumnProfile {
  index: number;
  name: string;
  inferred_type: "numeric" | "duration" | "datetime" | "text" | "empty";
  non_empty: number;
  numeric_rate: number;
  sample: string[];
  header_unit: string | null;
  suggested_field: string | null;
  min: number | null;
  max: number | null;
}

export interface ParserOptions {
  encoding?: string | null;
  delimiter?: string | null;
  header_row?: number | null;
  decimal?: string | null;
  dayfirst?: boolean | null;
  current_sign?: "discharge_negative" | "discharge_positive" | null;
}

export interface Preview {
  parser: {
    encoding: string;
    delimiter: string;
    header_row: number;
    decimal: string;
    dayfirst: boolean | null;
    dayfirst_detected: string | null;
    current_sign: string | null;
    auto: Record<string, boolean>;
  };
  preamble: string[];
  columns: ColumnProfile[];
  mapping: MappingEntry[];
  raw_rows: { source_line: number; cells: string[] }[];
  normalized_preview: Record<string, number | string | null>[];
  issues: Issue[];
  counts: { errors: number; warnings: number; info: number };
  row_count: number;
  importable_rows: number;
  can_import: boolean;
  requires_acknowledgement: boolean;
  first_timestamp: string | null;
  last_timestamp: string | null;
  fields: Record<string, { label: string; units: string[]; multi: boolean }>;
  upload: Upload;
}

export interface Metric {
  key: string;
  label: string;
  value: number;
  unit: string;
  method: string;
}

export interface Dataset {
  id: string;
  battery_id: string;
  upload: { id: string; original_filename: string; sha256: string; uploaded_at: string };
  test_session_id: string | null;
  status: "active" | "superseded";
  parser_config: Preview["parser"];
  column_mapping: MappingEntry[];
  validation: { issues: Issue[]; counts: Preview["counts"]; preamble: string[] };
  acknowledged_warnings: string[];
  row_count: number;
  imported_rows: number;
  fields: string[];
  summary: { metrics: Metric[]; first_timestamp: string | null; last_timestamp: string | null; series_keys: string[] };
  imported_by: UserBrief | null;
  imported_at: string;
}

export interface Series {
  dataset_id: string;
  total_points: number;
  returned_points: number;
  downsampled: boolean;
  method: string;
  series: Record<string, (number | null)[]>;
}

export interface TestSession {
  id: string;
  battery_id: string;
  test_type: string;
  test_date: string | null;
  method: string | null;
  equipment: string | null;
  operator_name: string | null;
  ambient_temp_c: number | null;
  charge_current_a: number | null;
  discharge_current_a: number | null;
  charge_voltage_v: number | null;
  cutoff_voltage_v: number | null;
  notes: string | null;
  created_by: UserBrief | null;
  created_at: string;
}

export interface Measurement {
  id: string;
  battery_id: string;
  test_session_id: string | null;
  dataset_id: string | null;
  source_upload_id: string | null;
  name: string;
  label: string;
  value_num: number | null;
  value_text: string | null;
  unit: string | null;
  kind: "measured" | "user_entered" | "calculated" | "external" | "model_estimate";
  source_description: string | null;
  conditions: string | null;
  captured_at: string | null;
  recorded_by: UserBrief | null;
  created_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

export interface ChecklistEntry {
  item: string;
  result: "ok" | "issue" | "not_checked";
  comment?: string | null;
}

export interface Note {
  id: string;
  battery_id: string;
  test_session_id: string | null;
  note_type: "observation" | "inspection" | "review" | "general";
  body: string;
  checklist: ChecklistEntry[] | null;
  author: UserBrief | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceEvent {
  id: string;
  battery_id: string;
  event_type: string;
  description: string;
  performed_by_name: string | null;
  performed_on: string | null;
  created_by: UserBrief | null;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  battery_id: string | null;
  summary: string;
  details: Record<string, any>;
  actor: UserBrief | null;
  created_at: string;
}

export interface EvidenceCandidate {
  ref: string;
  type: "battery_record" | "test_session" | "measurement" | "dataset" | "note" | "file" | "completeness";
  origin: string;
  label: string;
  summary: string;
  default: boolean;
}

export interface EvidenceItem extends EvidenceCandidate {
  key: string;
  data: Record<string, any>;
}

export interface Paragraph {
  text: string;
  citations: string[];
}

export interface ReportSection {
  key: string;
  title: string;
  origin: "ai" | "ai_edited" | "template" | "template_edited" | "human";
  paragraphs: Paragraph[];
}

export interface ReportCheck {
  code: string;
  severity: "warning" | "info";
  message: string;
  section: string;
  paragraph: number | null;
  excerpt: string | null;
}

export interface Report {
  id: string;
  battery_id: string;
  report_number: string;
  version: number;
  previous_version_id: string | null;
  status: "draft" | "approved" | "superseded";
  title: string;
  generator: string;
  generated_by: UserBrief | null;
  generated_at: string;
  updated_at: string;
  approved_by: UserBrief | null;
  approved_at: string | null;
  open_checks: number;
  evidence?: EvidenceItem[];
  sections?: ReportSection[];
  checks?: ReportCheck[];
  reviewer_conclusion?: string | null;
  versions?: { id: string; version: number; status: string; updated_at: string }[];
  battery?: Battery;
  notice?: string | null;
}

export interface CatalogueItem {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  unit: string;
  unit_price_paise: number;
  tax_rate_bp: number;
  is_active: boolean;
  default_on_quotes: boolean;
  updated_at: string;
}

export interface QuotationLine {
  id?: string;
  position?: number;
  catalogue_item_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price_paise: number;
  tax_rate_bp: number;
  line_subtotal_paise?: number;
  line_tax_paise?: number;
  line_total_paise?: number;
  origin: "human" | "ai" | "template";
  rationale: string | null;
}

export interface Quotation {
  id: string;
  number: string;
  status: "draft" | "approved" | "sent" | "accepted" | "declined" | "void";
  revision: number;
  battery: { id: string; bos_id: string; status: string } | Battery;
  customer: Ref | null;
  report_id: string | null;
  issue_date: string | null;
  valid_until: string | null;
  subtotal_paise: number;
  tax_paise: number;
  total_paise: number;
  drafted_by: string;
  created_at: string;
  updated_at: string;
  approved_by: UserBrief | null;
  approved_at: string | null;
  sent_at: string | null;
  decided_at: string | null;
  notes?: string | null;
  terms?: string | null;
  draft_notes?: string | null;
  lines?: QuotationLine[];
  revisions?: { id: string; revision: number; status: string; reason: string | null; created_at: string; total_paise: number }[];
  report?: { id: string; report_number: string; version: number; status: string } | null;
}

export interface Dashboard {
  total_batteries: number;
  active_batteries: number;
  by_status: Record<string, number>;
  recently_received: Battery[];
  awaiting_data: Battery[];
  review_required: Battery[];
  recently_updated: Battery[];
  open_quotations: {
    counts: { draft: number; approved: number; sent: number };
    approved_or_sent_total_paise: number;
    items: Quotation[];
  };
  reports_awaiting_approval: number;
}

export interface Proposal {
  type: "status_change" | "note";
  battery_id: string;
  bos_id: string;
  from?: string;
  to?: string;
  reason?: string | null;
  note_type?: string;
  body?: string;
}
