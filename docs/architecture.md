# Architecture

A modular monolith: one FastAPI service and one Next.js web app. No queues, microservices, vector databases or agent
frameworks (brief §9).

```text
Browser ──► Next.js (apps/web, :3000) ──/api/* rewrite──► FastAPI (services/api, :8000) ──► SQLAlchemy ──► SQLite / PostgreSQL
                                                                   │
                                                                   ├── storage/   original files (content-addressed, read-only)
                                                                   └── Anthropic Messages API (optional, server-side only)
```

The browser only talks to its own origin. Next.js forwards `/api/*` to FastAPI, so the session cookie is first-party,
`HttpOnly` and `SameSite=Lax`. Every state-changing request must carry `x-batteryos-client: web`; browsers cannot add a
custom header cross-site without a CORS preflight the API refuses, which blocks CSRF.

## Request handling

1. `deps.get_session_user` resolves the opaque session token (only its SHA-256 is stored) and checks expiry/revocation.
2. `deps.get_ctx` resolves the active workspace membership and role.
3. `deps.require(permission)` checks the role against `domain.PERMISSIONS`.
4. Handlers load records only through `deps.get_scoped(ctx, Model, id)`, which adds `organization_id = ctx.org_id` and
   returns 404 for anything outside the workspace. List queries filter on `organization_id` explicitly.
5. Writes call `audit.log(...)` in the same transaction.

## Data model

| Table | Purpose |
| --- | --- |
| `organizations`, `users`, `organization_members`, `invitations`, `auth_sessions` | Workspaces, people, roles, invites, sessions |
| `customers`, `battery_batches`, `batteries` | Intake records; `batteries.provenance` maps each technical field to its source |
| `uploads` | Original files: name, type, size, SHA-256, storage key, uploader, user-supplied test metadata |
| `datasets` | One import of one upload: parser settings, column mapping, full validation report, acknowledged warnings, calculated summary |
| `measurement_points` | Normalised time series (canonical units) linked to a dataset; extra series (cells, extra sensors) in JSON |
| `test_sessions` | When/how/with what a test was done |
| `measurements` | Summary results with `kind` (measured / user_entered / calculated / external / model_estimate), conditions, source; voided, never edited |
| `technician_notes` | Observations, reviews, inspection checklists |
| `diagnostic_reports` | Versioned reports: frozen evidence snapshot, narrative sections with origin labels, automatic checks, reviewer conclusion, approval |
| `catalogue_items`, `quotations`, `quotation_lines`, `quotation_revisions` | Pricing, quotations (money in paise), revision/status snapshots |
| `service_events` | Inspection, repair, replacement, dispatch, warranty history |
| `audit_events` | Who did what, when, with details (diffs, acknowledged warnings) |

Every business table carries `organization_id`. IDs are random 128-bit hex strings. Timestamps are stored in UTC;
calendar dates (received, valid until) use the workspace time zone (default Asia/Kolkata).

Migrations: `services/api/alembic`. The API applies them at start-up unless `AUTO_MIGRATE=false`.

## CSV pipeline (`app/services/csv_ingest.py`)

`read_table` (encoding, delimiter, header row, decimal mark) → `profile_columns` (types, ranges, header units) →
`suggest_mapping` → `analyze` (conversion to canonical units + validation + cross-checks against the battery record) →
`summarize` (calculated metrics, each with its method) → `normalized_points`.

The analysis is pure and deterministic. Preview and import run the same function on the stored original bytes, so the
browser can never submit pre-processed data.

## Reports (`evidence.py`, `report_drafter.py`, `grounding.py`)

1. `evidence.candidates` lists every record that may be cited; the user picks which ones to include.
2. `evidence.build_pack` assigns citation keys and freezes the selected data into the report.
3. The drafter (AI or template) produces sections of paragraphs, each with citations.
   - AI: a single structured-output request. The JSON schema restricts citations to the pack's keys; the system prompt
     forbids new numbers, calculations, safety/fitness/SOH/value claims and final decisions, and tells the model to
     treat record text as data.
   - Template: deterministic sentences from the same pack.
4. `grounding.check_sections` runs on every draft and save: unsupported numbers, unknown citations, uncited
   statements, prohibited claims, SOH mentions without evidence.
5. Approval requires a human-written conclusion and explicit acknowledgement of open warnings; the version is then locked.

## Quotations (`quotation_drafter.py`, `routers/quotations.py`)

The AI receives the approved report text and the catalogue **without prices**; its response may only reference
catalogue IDs (schema enum). The server fills in prices and tax rates and computes totals with `Decimal`, half-up
rounding, in integer paise.

## Assistant (`routers/assistant.py`)

A bounded manual tool loop (max 6 steps) with read tools (`search_batteries`, `get_battery`, `workspace_overview`,
`list_quotations`) and propose-only tools (`propose_status_change`, `propose_note`). Every tool executes server-side with
the signed-in user's workspace and permissions. Proposals are returned to the UI; applying one calls the normal endpoint.

## Frontend

Next.js App Router with client-rendered pages (all data is per-user and behind the session). TanStack Query for data,
Radix UI primitives for dialogs/menus/tooltips, Recharts for charts, sonner for toasts. Shared vocabularies come from
`GET /api/meta` so labels and allowed values match the server.
