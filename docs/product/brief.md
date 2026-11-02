# BatteryOS AI Employee

> **Project brief and build specification**
>
> BatteryOS is a workflow-automation platform for independent
> lithium-ion battery refurbishers, repair businesses, and second-life
> battery operators. Its first product is an AI operations employee that
> helps a business take a battery from intake to a documented diagnostic
> review, quotation, and inventory update.

------------------------------------------------------------------------

## 1. Product vision

BatteryOS aims to become the operating system for battery refurbishment
and second-life battery businesses.

These businesses often manage battery intake, BMS files, test results,
technician notes, repairs, quotations, inventory, customer
communication, and warranty records across spreadsheets, messaging apps,
paper forms, and disconnected tools.

BatteryOS brings those workflows into one system. AI agents assist with
repetitive administrative and information-processing work, while
deterministic software handles records, calculations, permissions, and
workflow state. Qualified people remain responsible for physical
inspections, safety decisions, and approval of customer-facing
conclusions.

**Long-term vision:** a trusted lifecycle information and workflow
platform connecting refurbishers, service centres, fleet operators,
battery owners, OEMs, and other participants in the battery ecosystem.

**Initial wedge:** make battery intake, test-data organization, report
preparation, and quotation creation significantly easier for small and
medium-sized battery businesses.

## 2. The problem

A typical refurbisher may receive a batch of used battery packs and need
to:

1.  Register each pack and record its identifying information.
2.  Collect available BMS exports, test files, photos, and technician
    notes.
3.  Check whether the supplied data is complete and plausible.
4.  Arrange or record physical inspection and capacity testing.
5.  Review measured results and any model-generated estimates.
6.  Decide what additional tests or human review are required.
7.  Prepare a customer quotation.
8.  Track the battery through inventory, repair, dispatch, and warranty.

The process is often fragmented and time-consuming. Information can be
difficult to retrieve later, and reports may be inconsistent between
technicians or locations.

BatteryOS should reduce administrative effort, improve traceability, and
make the business's operational information easier to use. It must not
pretend that software can replace proper battery testing or qualified
safety judgement.

## 3. Target customers

### Initial ideal customer profile

Start with businesses that handle lithium-ion batteries repeatedly and
have a real operational workflow:

-   Independent lithium-ion battery refurbishers.
-   EV battery repair and service businesses.
-   E-rickshaw and electric two-wheeler battery service operators.
-   Second-life battery integrators and storage operators.
-   Small and medium-sized battery pack assemblers or service centres.

### Initial geography

Begin customer discovery in Jammu, Punjab, Delhi NCR, and nearby
industrial clusters, while remaining open to customers elsewhere in
India.

Do not assume the local market is large enough. Geography is a low-cost
starting point for interviews and pilots, not a limit on the eventual
market.

### Buyer and users

-   **Economic buyer:** business owner, founder, or operations manager.
-   **Daily users:** intake staff, technicians, service managers, and
    sales/admin staff.
-   **Potential later users:** fleet operators, OEM service networks,
    leasing companies, insurers, and recyclers.

## 4. Product positioning

**Positioning statement:**

> BatteryOS is an AI-assisted operations platform for battery
> refurbishment businesses. It organizes battery records and test data,
> prepares clear diagnostic documentation, and automates repetitive
> workflow tasks from intake through quotation and after-sales tracking.

Do not position the initial product as: - A certified battery safety
tester. - A replacement for laboratory capacity testing. - A universal
SOH estimator that works accurately on every chemistry and pack. - A
hardware diagnostic device. - A battery marketplace. - A generic
chatbot.

The differentiator is the connected workflow and the operational
record---not the use of AI as a marketing label.

## 5. The first product: BatteryOS Intake & Intelligence

The MVP should solve one complete, narrow workflow:

**Register a battery → attach data and evidence → validate and organize
it → prepare a human-reviewed report → draft a quotation → update the
battery's status.**

### MVP features

#### A. Business workspace and users

-   Business/workspace registration.
-   Secure sign-in.
-   Basic roles: owner/admin and staff.
-   All records scoped to the correct business.
-   Basic audit history for important actions.

#### B. Battery intake and inventory

-   Create a battery record.
-   Assign a unique BatteryOS ID.
-   Capture customer/supplier, received date, battery type, chemistry
    (if known), nominal voltage, rated capacity, pack configuration (if
    known), manufacturer/model, serial number, and notes.
-   Record photos and uploaded documents.
-   Track status, for example: `received`, `awaiting_data`, `testing`,
    `review_required`, `quoted`, `approved`, `repair_in_progress`,
    `ready`, `dispatched`, `rejected`, and `archived`.
-   Search and filter records.

Do not make unknown fields mandatory. Record unknown or unverified
values explicitly.

#### C. Data and document ingestion

-   Upload CSV files in the first release.
-   Store original files unchanged.
-   Allow users to map CSV columns to known fields.
-   Validate file format, required columns, units, timestamps, missing
    values, and obvious anomalies.
-   Show a preview before importing.
-   Preserve source filename, upload time, uploader, and any
    user-provided test metadata.
-   Keep raw measurements separate from normalized/derived values.

Potential later integrations include specific BMS export formats, CAN
logs, test equipment, and APIs. Do not promise universal BMS
compatibility in the MVP.

#### D. Diagnostic workspace

Show available information in a structured way: - Voltage, current,
temperature, time, and other supplied measurements. - Test metadata such
as chemistry, temperature, test profile, charge/discharge conditions,
and equipment, when supplied. - Data completeness and validation
warnings. - Technician observations. - Results from external tests,
clearly labelled with their source. - Optional model estimates, only
when a validated model is available for the relevant use case.

The first release can organize and visualize data without making an SOH
prediction. A reliable workflow product is more valuable than an
unvalidated prediction.

#### E. AI report assistant

The AI assistant can: - Summarize uploaded records and technician
notes. - Explain missing information and data-quality warnings in plain
language. - Draft a diagnostic report from approved source data. -
Clearly distinguish measured values, user-entered values, model
estimates, and AI-generated narrative. - Suggest questions or additional
tests for a qualified technician to consider. - Generate a report draft
for human review.

The AI must never invent measurements, test results, certifications, or
battery history. Every important statement in a report should be
traceable to a source record or explicitly labelled as an estimate or
interpretation.

#### F. Quotation assistant

-   Maintain editable service/repair line items and prices.
-   Draft a quotation using approved findings and business-defined
    pricing.
-   Allow staff to edit and approve it.
-   Export a PDF.
-   Record quotation status and revisions.

The AI may prepare a draft; it must not send or commit a quotation
without an authorized user's approval.

#### G. Basic dashboard

Show: - Total batteries in the workspace. - Batteries by current
status. - Recently received batteries. - Records awaiting data or
technician review. - Open quotations. - Recently updated records.

Avoid vanity metrics. Only show counts that can be calculated reliably
from stored records.

## 6. Example user journey

1.  A customer contacts a refurbisher about a batch of 40 used 48 V
    lithium battery packs.
2.  Staff create a batch or individual battery records and capture the
    known details.
3.  Staff upload the available BMS CSV exports and test documents.
4.  BatteryOS checks the files, previews the data, and flags missing or
    inconsistent fields.
5.  The system associates each imported file with the correct battery
    record.
6.  A technician reviews the available data and records physical
    inspection or test findings.
7.  The AI report assistant prepares a draft summary using only the
    available evidence.
8.  A qualified staff member reviews and approves the report.
9.  The quotation assistant prepares a draft using the business's
    service catalogue and approved findings.
10. An authorized staff member edits and approves the quotation.
11. BatteryOS updates the inventory and retains the records for future
    repair and warranty tracking.

For the MVP, it is acceptable to start with one battery at a time rather
than full batch processing.

## 7. AI agent design principles

Do not build one autonomous agent with unrestricted access to the whole
application. Use a controlled assistant with narrowly scoped tools and
explicit approval steps.

### Suggested logical components

-   **Intake assistant:** extracts candidate details from user-provided
    text or documents and asks for confirmation.
-   **Data assistant:** explains file structure and data-quality issues;
    deterministic validators perform the actual checks.
-   **Report assistant:** drafts summaries from approved records and
    cites the underlying record/file references.
-   **Quotation assistant:** drafts quotations from approved findings
    and configured price lists.
-   **Workflow assistant:** answers questions about records and can
    propose permitted status changes.

These can initially be implemented as one LLM-backed assistant with a
small set of server-side tools. Separate agents are not required for the
MVP.

### Tool boundaries

AI tools may: - Search records within the user's workspace. - Read
approved battery metadata and test summaries. - Create draft notes and
report text. - Prepare draft quotations. - Propose a status change.

AI tools must not, without explicit user approval: - Delete records or
source files. - Change measured data. - certify safety or compliance. -
Approve a diagnostic report. - Approve or send a quotation. - Make a
final repair, reuse, rejection, or resale decision. - Make unsupported
SOH, remaining-life, or valuation claims.

Use server-side authorization for every tool. Never rely on the LLM to
enforce permissions.

## 8. Safety, trust, and data integrity

BatteryOS is an operational information system, not a safety
certification system.

Mandatory principles:

1.  **Preserve raw data.** Never overwrite source measurements.
2.  **Track provenance.** Store where each value came from, when it was
    captured, its units, and who supplied it.
3.  **Separate facts from estimates.** UI and reports must distinguish
    measured, user-entered, calculated, model-estimated, and
    AI-generated information.
4.  **Show test conditions.** A capacity or SOH result is meaningful
    only with relevant test conditions and methodology.
5.  **No universal SOH claims.** Models must be validated for the
    relevant chemistry, cell/pack design, operating conditions, and data
    distribution.
6.  **Human review.** A qualified person reviews diagnostic conclusions
    and all customer-facing reports.
7.  **No safety certification.** Do not label a battery safe, unsafe,
    certified, or fit for a particular use based only on AI output.
8.  **Auditability.** Record important edits, approvals, imports, and
    status changes.
9.  **Tenant isolation.** One business must never access another
    business's records.
10. **Secure uploads.** Validate file type and size, protect stored
    files, and avoid executing uploaded content.

If future versions include battery-health estimation, build a separate,
testable analytics service. Report uncertainty, model version,
applicable conditions, and limitations. Do not allow a language model to
calculate or fabricate technical measurements.

## 9. Suggested technology stack

Choose familiar, maintainable tools. Avoid unnecessary infrastructure.

  -----------------------------------------------------------------------
  Layer                   Suggested technology    Purpose
  ----------------------- ----------------------- -----------------------
  Web frontend            Next.js + TypeScript    Responsive business
                                                  dashboard

  UI                      Tailwind CSS + a        Consistent interface
                          component library       

  Backend                 Python + FastAPI        API and business logic

  Database                PostgreSQL (Supabase is Multi-tenant structured
                          a practical starting    records
                          option)                 

  Authentication          Supabase Auth or        Sign-in and user
                          equivalent              management

  File storage            Supabase Storage or     CSVs, PDFs, and photos
                          equivalent              

  Data processing         Python, Pandas          CSV parsing and
                                                  validation

  Charts                  A React charting        Time-series
                          library                 visualization

  LLM                     An API-based model with Drafting and workflow
                          tool calling            assistance

  PDF reports             Server-side PDF         Downloadable reports
                          generation              

  Hosting                 Managed frontend and    Low-operations
                          backend hosting         deployment
  -----------------------------------------------------------------------

Use a modular monolith initially. Do not start with microservices,
Kubernetes, a vector database, or a complex multi-agent framework unless
a demonstrated requirement emerges.

### Suggested repository structure

``` text
batteryos/
  apps/
    web/                  # Next.js frontend
  services/
    api/                  # FastAPI backend
  packages/
    shared-types/         # Shared API/data types if useful
  docs/
    product/
    architecture/
    decisions/
  scripts/
  README.md
  .env.example
```

This is a suggested structure, not a requirement. Keep the initial
repository simpler if that speeds up delivery.

## 10. Initial data model

Design the schema around business workspaces and traceable records.

### Core entities

-   `organizations`: customer businesses/workspaces.
-   `users`: authenticated users.
-   `organization_members`: user-to-workspace membership and role.
-   `customers`: the refurbisher's customers or suppliers.
-   `batteries`: individual battery/pack records and metadata.
-   `battery_batches`: optional grouping for multiple batteries.
-   `uploads`: original files and ingestion metadata.
-   `test_sessions`: test date, method, equipment, conditions, operator,
    and notes.
-   `measurements`: normalized time-series or summary measurements,
    linked to a source.
-   `technician_notes`: observations and review notes.
-   `diagnostic_reports`: draft/approved report versions and provenance.
-   `quotations`: quotation headers, line items, totals, status, and
    revisions.
-   `service_events`: inspection, repair, replacement, and maintenance
    history.
-   `audit_events`: important user and system actions.

Every business-owned record should include an `organization_id`. Enforce
tenant isolation in the backend and, where supported, at the database
policy layer.

Avoid overengineering the time-series schema before sample files are
understood. A raw-file-first approach with a normalized subset of
important fields is acceptable for the MVP.

## 11. API surface for the first release

Illustrative endpoints:

``` text
POST   /auth or managed auth provider

GET    /organizations/current
GET    /batteries
POST   /batteries
GET    /batteries/{battery_id}
PATCH  /batteries/{battery_id}
GET    /batteries/{battery_id}/uploads
POST   /batteries/{battery_id}/uploads
POST   /uploads/{upload_id}/preview
POST   /uploads/{upload_id}/import

GET    /batteries/{battery_id}/test-sessions
POST   /batteries/{battery_id}/test-sessions

POST   /batteries/{battery_id}/report-drafts
GET    /batteries/{battery_id}/reports
POST   /reports/{report_id}/approve

POST   /batteries/{battery_id}/quotation-drafts
GET    /quotations
GET    /quotations/{quotation_id}
PATCH  /quotations/{quotation_id}
POST   /quotations/{quotation_id}/approve
GET    /quotations/{quotation_id}/pdf
```

The exact API can change as implementation decisions are made. Enforce
authorization, input validation, audit logging, and tenant scoping on
every relevant endpoint.

## 12. Go-to-market strategy

### Phase 1: Discovery before development

Interview at least 15--20 potential customers. Aim to observe their
current workflow, not just ask whether they like the idea.

Ask: - How many batteries/packs do you receive in a typical week or
month? - What types and chemistries do you handle? - How do you register
and identify each battery? - Which BMS exports and test equipment do you
use? - How do you currently record test results? - How long does it take
to prepare a report and quotation? - Where do records get lost or
duplicated? - How do you track repairs and warranty claims? - What
software do you already pay for? - Who would approve a purchase, and
what budget could they use? - Would you pay for a pilot that solves this
specific workflow?

Try to obtain anonymized sample files and permission to observe a real
process. Do not collect confidential customer data without permission.

### Phase 2: Design-partner pilots

Recruit 3--5 businesses willing to test the MVP. Start with one workflow
and a small number of batteries.

Measure: - Time required to register a battery. - Time required to
assemble a diagnostic report. - Time required to prepare a quotation. -
Percentage of records with complete source information. - Number of
errors or corrections. - Weekly active staff usage. - Whether the
business would pay to continue.

### Phase 3: Paid validation

A proposed early pricing hypothesis:

  Plan             Indicative monthly price
  -------------- --------------------------
  Starter                            ₹2,999
  Professional                       ₹7,999
  Enterprise                       ₹19,999+

These are hypotheses to test, not established market prices. Consider a
paid pilot or setup fee if the business receives measurable value.

### Sales channels

-   Direct visits and calls to refurbishers and service centres.
-   Industry introductions and referrals.
-   LinkedIn outreach to business owners and operations managers.
-   Relevant EV and battery trade groups.
-   Partnerships with test-equipment vendors and battery consultants.

Lead with a specific outcome---less time preparing reports, better
traceability, or fewer missed workflow steps---not with "AI-powered
software."

## 13. Business model and expansion

Potential revenue streams:

1.  Monthly SaaS subscriptions per business/location.
2.  Usage-based fees for high-volume processing or reports.
3.  Paid onboarding and data-format integrations.
4.  Enterprise API and white-label licensing.
5.  Later, integrations with fleet, OEM, leasing, warranty, and
    recycling workflows.

The long-term opportunity is to become a system of record and workflow
infrastructure for battery lifecycle businesses. This is an ambition,
not a guaranteed outcome.

Illustrative scale arithmetic: - 1,000 customers at ₹10,000 average
monthly revenue = ₹12 crore annualized recurring revenue. - 5,000
customers at ₹17,000 average monthly revenue = ₹102 crore annualized
recurring revenue.

These scenarios do not establish that the customer counts or prices are
achievable. Validate the addressable market, sales cycle, retention,
gross margin, and willingness to pay.

## 14. Initial budget

The founder's initial capital constraint is under ₹1 lakh. Keep the
first release lean and avoid hardware development.

Indicative planning allocation:

  Expense                           Initial allowance
  ------------------------------- -------------------
  Domain and basic hosting                     ₹3,000
  Database and storage                         ₹2,000
  LLM API experimentation                      ₹5,000
  Messaging/API experimentation                ₹5,000
  Testing and deployment                       ₹5,000
  Customer visits and travel                  ₹10,000
  Miscellaneous                                ₹5,000
  **Planned initial spend**               **₹35,000**

These are rough allowances, not vendor quotes. Keep the rest as a
reserve. Use free tiers and local development where sensible, but do not
compromise security for production customer data.

## 15. First 90-day execution plan

### Days 1--15: Validate

-   Identify and contact 20 businesses.
-   Conduct workflow interviews and observe operations.
-   Obtain sample anonymized CSVs and report templates.
-   Identify the most common battery types and file formats.
-   Secure 3--5 design partners.
-   Decide whether the intake/report/quotation workflow is painful
    enough to pay for.

**Gate:** Do not build a broad platform if customer discovery does not
reveal a repeated, costly workflow.

### Days 16--35: Build the MVP

-   Implement authentication and organization isolation.
-   Build battery intake and inventory.
-   Add CSV upload, preview, validation, and source-file storage.
-   Build a diagnostic workspace.
-   Add AI-assisted report drafts with source references.
-   Add editable quotation drafts and PDF export.

### Days 36--60: Pilot

-   Onboard 3--5 design partners.
-   Observe actual staff usage.
-   Fix confusing workflows and import failures.
-   Track time saved and report corrections.
-   Keep a human approval step for reports and quotations.

### Days 61--90: Monetize

-   Convert successful pilots into paid accounts.
-   Test pricing and onboarding fees.
-   Identify the features customers use repeatedly.
-   Measure retention and usage.
-   Decide whether to deepen the product or change the target segment.

## 16. MVP acceptance criteria

The first MVP is ready for a pilot when:

-   A business owner can create a workspace and invite staff.
-   A staff member can register and find a battery.
-   A user can upload a CSV and preview it before import.
-   Invalid or ambiguous data is flagged rather than silently accepted.
-   Original files remain available and unchanged.
-   A technician can add observations and test-session details.
-   The AI can draft a report using only the selected record data.
-   The report labels measured values, estimates, and AI-generated
    narrative distinctly.
-   A human can edit and approve a report.
-   A user can draft, edit, approve, and export a quotation.
-   Battery status and history are visible.
-   One organization's users cannot access another organization's
    records.
-   Important changes and approvals are auditable.

## 17. Explicitly out of scope for MVP

Do not build these in the first release:

-   Custom battery diagnostic hardware.
-   Universal integrations with every BMS.
-   Automatic safety certification.
-   Unvalidated universal SOH or remaining-life prediction.
-   Autonomous repair or reuse decisions.
-   Battery trading marketplace.
-   Payments and financing.
-   Complex multi-agent autonomy.
-   Mobile apps for iOS and Android (responsive web is sufficient
    initially).
-   Large-scale OEM integrations.

These may become future opportunities after customer demand is
demonstrated.

## 18. Key open questions to resolve during discovery

Do not guess the answers. Use customer interviews and sample data.

-   Which battery segment has the most painful workflow?
-   Which chemistries and pack configurations are most common among
    initial customers?
-   Which BMS export formats and test equipment are actually used?
-   Do customers need full time-series data, or are test summaries
    sufficient initially?
-   Who currently performs and signs off on diagnostic assessments?
-   What report format do customers expect?
-   What measurable time or cost savings would justify a subscription?
-   Is the buyer the owner, workshop manager, or another stakeholder?
-   What existing software must BatteryOS integrate with?
-   What privacy, retention, safety, and regulatory obligations apply to
    each customer and use case?

## 19. How a new AI coding assistant should work on this project

When using this README in a new coding chat, follow these instructions:

1.  Treat this document as the product brief and initial scope.
2.  Do not start by generating the entire application in one response.
3.  First propose a concise architecture and implementation plan for the
    MVP.
4.  Identify assumptions and ask only questions that block a sound
    technical decision.
5.  Build incrementally, one vertical slice at a time.
6.  Prefer simple, maintainable implementations over unnecessary
    abstraction.
7.  Include database migrations, validation, authorization, and tests
    with relevant features.
8.  Never invent battery measurements, technical conclusions, or
    customer data.
9.  Keep raw uploaded data immutable and preserve provenance.
10. Clearly identify mock data and demo-only functionality.
11. Do not claim a feature is complete unless it has been implemented
    and tested.
12. Keep this README updated when major product or architecture
    decisions change.

### Recommended first coding task

Start by proposing the MVP architecture, database schema, repository
structure, and a short implementation sequence. Then implement the first
vertical slice:

**Create a workspace → register a battery → view its detail page →
upload a CSV → preview and validate the file.**

Do not implement AI report generation until the underlying records and
data provenance are reliable.

------------------------------------------------------------------------

## 20. One-sentence summary

**BatteryOS is an AI-assisted operating system for battery refurbishment
businesses, starting with battery intake, test-data organization,
human-reviewed diagnostic reporting, quotation generation, and inventory
workflows---and expanding over time into battery lifecycle intelligence
infrastructure.**
