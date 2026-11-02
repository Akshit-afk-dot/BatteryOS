# BatteryOS

An operations system for lithium-ion battery refurbishment, repair and second-life businesses. This repository is the first
product, **BatteryOS Intake & Intelligence**: register a battery → attach data and evidence → validate and organise it →
prepare a human-reviewed diagnostic report → draft a quotation → track the battery's status and history.

The product brief this was built from is in [docs/product/brief.md](docs/product/brief.md). Architecture notes are in
[docs/architecture.md](docs/architecture.md) and the main decisions are recorded in [docs/decisions](docs/decisions).

> BatteryOS is an operational record system. It does not certify batteries as safe, does not replace laboratory testing,
> and does not estimate state of health without a validated model. Qualified people make every safety and final decision.

---

## Quick start

Requirements: **Python 3.11+** and **Node.js 20+** (tested with Python 3.12 and Node 25 on Windows 11).

```bash
npm run setup        # creates .venv, installs API + web dependencies, generates synthetic sample CSVs
npm run seed:demo    # optional: a clearly-labelled demo workspace with sample data
npm run dev          # API on http://localhost:8000, web app on http://localhost:3000
```

Open http://localhost:3000 and either **create a workspace** or sign in to the demo workspace (account and password are in
[scripts/seed_demo.py](scripts/seed_demo.py)). The database is created and migrated automatically on first start.

Other commands:

| Command | What it does |
| --- | --- |
| `npm test` | Runs the API test suite (83 tests: auth, tenant isolation, permissions, CSV validation, import, reports, quotations, assistant). |
| `npm run typecheck` | TypeScript check of the web app. |
| `npm run build` | Production build of the web app. |
| `npm run start:api` / `npm run start:web` | Run the API / the built web app without dev reloading. |

Configuration lives in `services/api/.env` — copy [services/api/.env.example](services/api/.env.example). Nothing is
required for local use.

### Enabling the AI assistant

Set `ANTHROPIC_API_KEY` in `services/api/.env` and restart the API. The model defaults to `claude-opus-5-5`
(`ANTHROPIC_MODEL` to change it). Requests opt into Anthropic's server-side fallback (`fallbacks: "default"`), so if the
model declines a request for policy reasons the API retries it on Anthropic's recommended fallback model.

Without a key everything still works: report drafts come from a deterministic template, quotation drafts start from
catalogue defaults, intake text is parsed with pattern matching, and the chat assistant shows how to enable it.

---

## What you can do

**Workspace and team**
- Create a workspace (each business is fully isolated), switch between workspaces, create more.
- Roles: **owner**, **admin**, **technician**, **staff** — enforced by the server on every request
  (see the matrix in [services/api/app/domain.py](services/api/app/domain.py)).
- Invite people with a one-time link (7-day expiry, revocable). BatteryOS does not send email yet; you share the link.
- Deactivate members, change roles (the last owner cannot be removed), change your password (signs out other sessions).

**Intake and inventory**
- Register a battery with only what you know; every unknown field is shown as *Unknown*, never guessed.
- Each identifying/technical value records where it came from: nameplate, datasheet, BMS, customer-reported,
  technician-verified or not verified.
- Paste a customer message or label transcription and extract details (AI, or pattern matching without a key).
  Suggestions are highlighted and only applied when you choose.
- Unique IDs per workspace (`BOS-26-00001`, prefix configurable), customers/suppliers, batches, and bulk registration
  of up to 200 batteries in a batch.
- Status workflow (`received → awaiting_data → testing → review_required → quoted → approved → repair_in_progress →
  ready → dispatched`, plus `rejected`/`archived`) with allowed transitions and required reasons for rejection/archiving.
- Search, filter (status, chemistry, customer, archived) and sort; record-completeness checklist per battery;
  service events (repair, replacement, dispatch, warranty claims) and warranty expiry.

**Files and data**
- Upload CSV/TXT/TSV, JPG/PNG/WebP and PDF (25 MB). Type is checked by content, not just extension.
- Originals are stored unchanged, content-addressed and read-only, with a SHA-256 fingerprint you can re-verify.
- CSV preview before import: auto-detects delimiter, header row (skips metadata lines), decimal comma, encoding and
  date order; suggests a column mapping with units; shows the file as read and as it will be imported.
- Deterministic validation with line numbers: missing time column, unreadable rows, non-numeric values, missing values,
  time going backwards, duplicates, logging gaps, assumed units (mV vs V, A vs mA, °C/°F/K, time units), unconfirmed
  current sign, out-of-range values, high temperatures, constant (stuck) sensors, sudden voltage jumps, and cross-checks
  against the battery record (nominal voltage, cell count vs pack configuration, chemistry voltage window, current vs
  rated capacity). Errors block import; warnings must be acknowledged.
- Normalised data is stored separately in standard units and can be exported; re-importing supersedes the previous
  dataset without deleting it.

**Diagnostics**
- Charts for pack voltage/current, temperatures/SOC and every cell voltage (weakest cell highlighted), downsampled for
  display with extremes preserved.
- Calculated values (duration, voltage range, charge/energy throughput, temperatures, cell spread…) each with the
  method used to compute it — clearly labelled *calculated*, and charge throughput is explicitly not a capacity result.
- Test sessions with conditions (equipment, operator, ambient, currents, voltages, method).
- Results are labelled **measured** (must be linked to a test session), **external** (must state the source),
  **user-entered** or **model estimate** (must name the model and its validity). Results are never edited — wrong ones
  are voided with a reason and stay in history.
- Technician notes and a structured visual-inspection checklist.
- An explicit "no validated model is configured" panel instead of any SOH estimate.

**Diagnostic reports**
- Choose exactly which records a draft may use. They are frozen into the report with citation keys (B1, T1, M1, D1, N1…).
- Draft with AI (only the selected evidence is sent; citations are constrained to those keys) or with the template.
- Deterministic record blocks (identity with provenance, results with kinds and conditions, calculated metrics,
  inspection) are shown exactly as recorded and cannot be edited in the report.
- Automatic checks flag numbers that don't appear in the evidence, unknown citations, uncited statements and claims of
  safety, certification, compliance, fitness for use, remaining life, value or final decisions.
- Edit the narrative (sections are re-labelled *AI draft · edited* / *Template · edited* / *Written by reviewer*),
  write the reviewer conclusion, and approve. Approval requires the conclusion and an explicit confirmation of any
  flagged statements, records who approved, and locks the version. Corrections create a new revision.
- PDF export with provenance labels, evidence index, approval block, disclaimer and a DRAFT watermark until approved.

**Quotations**
- Service catalogue with your prices and GST (a starter set with clearly marked example prices is available).
- Draft from the approved report: AI suggests catalogue items and quantities with a rationale (it never sees or sets
  prices); without AI, catalogue defaults are added.
- Edit lines, quantities, rates and GST; totals are recomputed on the server in paise with half-up rounding.
- Approve (owner/admin), mark sent / accepted / declined / void, and revise. Every approval and status change is
  snapshotted. Approving moves the battery to *Quoted* and acceptance to *Approved* when the workflow allows it.
- PDF export with Indian number formatting and a DRAFT watermark until approved.

**Dashboard, audit and assistant**
- Dashboard counts come straight from stored records (no estimated metrics): status breakdown, items needing
  attention, open quotations, recent activity, and a getting-started checklist.
- Audit log of sign-ins, edits (with before/after values), uploads, imports, results, voids, status changes, report and
  quotation actions, team and settings changes.
- Workflow assistant (needs an API key): answers questions using read-only, workspace-scoped tools and can only
  **propose** a status change or a note; nothing changes until a person presses *Apply*, which goes through the normal
  authorised endpoint and is audited as assistant-proposed.

---

## How the brief's safeguards are implemented

| Principle (brief §7–8) | Where |
| --- | --- |
| Preserve raw data | [storage.py](services/api/app/storage.py) (content-addressed, read-only, SHA-256 verified on download); no delete endpoints for uploads |
| Track provenance | `provenance` on batteries, `kind`/source/conditions on measurements, parser config + mapping + validation stored with every dataset |
| Separate facts from estimates | Kind badges in the UI and PDF; calculated values carry their method; model estimates require a named source |
| Show test conditions | Test sessions; measured values must link to one; reports print conditions or "not recorded" |
| No universal SOH claims | No SOH model; explicit panel; grounding check flags SOH wording without evidence |
| Human review | Reports need a human conclusion and approval; quotations need owner/admin approval |
| No safety certification | Prompt rules, prohibited-claim checks, PDF disclaimer |
| Auditability | [audit.py](services/api/app/audit.py), per-battery history, audit log page |
| Tenant isolation | Every query is scoped by `organization_id` through `get_scoped`; cross-tenant access returns 404 — covered by [test_tenancy.py](services/api/tests/test_tenancy.py) |
| Secure uploads | Extension + magic-byte checks, size limit, sanitised names, files never executed, downloads sent with `nosniff`, sandboxed CSP and attachment disposition |
| AI tool boundaries | [assistant.py](services/api/app/routers/assistant.py): read tools + two propose-only tools, all scoped server-side; AI never writes |

---

## Project structure

```text
batteryos/
  apps/web/                 Next.js 15 + TypeScript + Tailwind CSS 4 (Radix UI, TanStack Query, Recharts)
    src/app/(auth)/         sign in, create workspace, accept invitation
    src/app/(app)/          dashboard, batteries (+ detail tabs, CSV import), reports, quotations,
                            customers, batches, catalogue, settings, audit log
    src/components/         UI kit, app shell, assistant panel, battery tabs, badges
  services/api/             FastAPI + SQLAlchemy 2 + Alembic + pandas + ReportLab
    app/routers/            auth, organizations, customers/batches, batteries, uploads/datasets,
                            technical (tests, results, notes), reports, quotations/catalogue,
                            dashboard/audit, assistant
    app/services/           csv_ingest, evidence, grounding, report_drafter, quotation_drafter, pdf, llm, records
    alembic/                database migrations
    tests/                  pytest suite
  scripts/                  bos.mjs (setup/dev/test runner), seed_demo.py, generate_samples.py
  samples/                  SYNTHETIC CSV files for trying the importer (not real battery data)
  docs/                     product brief, architecture, decision records
```

---

## Demo and sample data

- `samples/` holds **synthetic** CSVs produced by `scripts/generate_samples.py` from a simple model. One is clean, one
  is a messy BMS export with deliberate problems (metadata lines, semicolons, decimal commas, ambiguous dates, gaps,
  a clock reset, a non-numeric reading, a high temperature, a weak cell), and one has no time column (rejected).
- `npm run seed:demo` creates "Demo Refurbishers (sample data)". Every customer, note and value in it is marked as sample
  or synthetic. Use a separate database (`DATABASE_URL`) for real work, or delete `services/api/data/` to start clean.

---

## Not built yet / known limitations

- **No email sending** — invitations are shared as links, and there is no forgotten-password reset yet (signed-in
  users can change their password in Settings).
- **SQLite by default.** The models are PostgreSQL-compatible and the code uses row locking for numbering, but
  PostgreSQL has not been tested here, and database-level row security (RLS) is not set up; isolation is enforced in the
  API (see [docs/decisions/0003-tenant-isolation.md](docs/decisions/0003-tenant-isolation.md)).
- **Local file storage.** Swap [storage.py](services/api/app/storage.py) for S3/Supabase Storage before running more than
  one API instance.
- **Rate limiting is in-process**; use a shared limiter or gateway when scaling out.
- CSV is the only data format; time-series files need a time column. Per-cell summary files (no time) are rejected with
  a clear message — record those values as results instead.
- The AI paths were verified with automated tests that mock the model; with no API key available here, they have
  not been run against the live Claude API.
- Out of scope per the brief: hardware, universal BMS integrations, safety certification, SOH prediction, autonomous
  decisions, marketplace, payments, native mobile apps (the web app is responsive).
