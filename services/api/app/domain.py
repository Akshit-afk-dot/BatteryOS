"""Fixed vocabularies, the status workflow, and the role/permission matrix.

These are deliberately plain data so the frontend can mirror them and tests can
assert on them. Authorization decisions are always made server-side from this
table, never by the AI assistant.
"""

from __future__ import annotations

ROLES = ("owner", "admin", "technician", "staff")

PERMISSIONS: dict[str, set[str]] = {
    # Workspace administration
    "org.update": {"owner", "admin"},
    "members.manage": {"owner", "admin"},
    "audit.view": {"owner", "admin"},
    "catalogue.manage": {"owner", "admin"},
    # Records
    "records.view": {"owner", "admin", "technician", "staff"},
    "batteries.write": {"owner", "admin", "technician", "staff"},
    "customers.write": {"owner", "admin", "technician", "staff"},
    "uploads.write": {"owner", "admin", "technician", "staff"},
    "data.import": {"owner", "admin", "technician", "staff"},
    # Technical work
    "tests.write": {"owner", "admin", "technician"},
    "measurements.void": {"owner", "admin", "technician"},
    "notes.write": {"owner", "admin", "technician", "staff"},
    "reports.draft": {"owner", "admin", "technician"},
    "reports.approve": {"owner", "admin", "technician"},
    # Commercial
    "quotations.draft": {"owner", "admin", "technician", "staff"},
    "quotations.approve": {"owner", "admin"},
    # Assistant
    "assistant.use": {"owner", "admin", "technician", "staff"},
}


def role_can(role: str, permission: str) -> bool:
    return role in PERMISSIONS.get(permission, set())


def permissions_for(role: str) -> list[str]:
    return sorted(p for p, roles in PERMISSIONS.items() if role in roles)


BATTERY_STATUSES = (
    "received",
    "awaiting_data",
    "testing",
    "review_required",
    "quoted",
    "approved",
    "repair_in_progress",
    "ready",
    "dispatched",
    "rejected",
    "archived",
)

# Allowed manual transitions. Kept permissive enough for real workshops (work
# can move back a step) while preventing jumps that skip the review/quote flow.
STATUS_TRANSITIONS: dict[str, set[str]] = {
    "received": {"awaiting_data", "testing", "review_required", "rejected", "archived"},
    "awaiting_data": {"received", "testing", "review_required", "rejected", "archived"},
    "testing": {"awaiting_data", "review_required", "rejected"},
    "review_required": {"awaiting_data", "testing", "quoted", "rejected"},
    "quoted": {"review_required", "approved", "rejected"},
    "approved": {"repair_in_progress", "ready", "quoted"},
    "repair_in_progress": {"testing", "review_required", "ready"},
    "ready": {"repair_in_progress", "dispatched"},
    "dispatched": {"archived", "repair_in_progress"},
    "rejected": {"received", "archived"},
    "archived": {"received"},
}

STATUSES_REQUIRING_REASON = {"rejected", "archived"}


def can_transition(current: str, target: str) -> bool:
    return target in STATUS_TRANSITIONS.get(current, set())


BATTERY_TYPES = (
    "ev_pack",
    "e_rickshaw",
    "two_wheeler",
    "energy_storage",
    "module",
    "cell",
    "other",
    "unknown",
)

CHEMISTRIES = ("LFP", "NMC", "NCA", "LCO", "LMO", "LTO", "other", "unknown")

# Where a battery's identifying / technical value came from.
PROVENANCE_SOURCES = (
    "nameplate",
    "datasheet",
    "bms_reported",
    "customer_reported",
    "technician_verified",
    "unverified",
)

PROVENANCE_FIELDS = (
    "chemistry",
    "nominal_voltage_v",
    "rated_capacity_ah",
    "pack_configuration",
    "manufacturer",
    "model",
    "serial_number",
    "bms_info",
)

MEASUREMENT_KINDS = ("measured", "user_entered", "calculated", "external", "model_estimate")

# Common summary measurements. `other` lets technicians record anything else
# with a custom label and unit.
MEASUREMENT_NAMES: dict[str, dict[str, str]] = {
    "capacity_ah": {"label": "Discharge capacity", "unit": "Ah"},
    "energy_wh": {"label": "Discharge energy", "unit": "Wh"},
    "internal_resistance_mohm": {"label": "Internal resistance (pack)", "unit": "mΩ"},
    "open_circuit_voltage_v": {"label": "Open-circuit voltage", "unit": "V"},
    "cell_voltage_min_v": {"label": "Lowest cell voltage", "unit": "V"},
    "cell_voltage_max_v": {"label": "Highest cell voltage", "unit": "V"},
    "cell_voltage_spread_mv": {"label": "Cell voltage spread", "unit": "mV"},
    "insulation_resistance_mohm": {"label": "Insulation resistance", "unit": "MΩ"},
    "cycle_count_bms": {"label": "Cycle count (BMS reported)", "unit": "cycles"},
    "soh_pct": {"label": "State of health", "unit": "%"},
    "max_temperature_c": {"label": "Maximum temperature during test", "unit": "°C"},
    "other": {"label": "Other", "unit": ""},
}

TEST_TYPES = (
    "capacity_test",
    "internal_resistance",
    "visual_inspection",
    "bms_readout",
    "cycle_test",
    "insulation_test",
    "cell_balance_check",
    "other",
)

NOTE_TYPES = ("observation", "inspection", "review", "general")

INSPECTION_ITEMS = (
    ("casing", "Casing / enclosure damage"),
    ("swelling", "Swelling or deformation"),
    ("leakage", "Electrolyte leakage or residue"),
    ("corrosion", "Corrosion on terminals or busbars"),
    ("connectors", "Connectors and wiring condition"),
    ("bms", "BMS present and responsive"),
    ("odour", "Unusual odour"),
    ("labels", "Labels / nameplate legible"),
)

INSPECTION_RESULTS = ("ok", "issue", "not_checked")

SERVICE_EVENT_TYPES = (
    "inspection",
    "repair",
    "replacement",
    "maintenance",
    "dispatch",
    "warranty_claim",
    "other",
)

CUSTOMER_KINDS = ("customer", "supplier", "both")

CATALOGUE_CATEGORIES = ("diagnostic", "repair", "part", "labour", "service", "other")

QUOTATION_STATUSES = ("draft", "approved", "sent", "accepted", "declined", "void")

UPLOAD_KINDS = ("csv", "photo", "document")
