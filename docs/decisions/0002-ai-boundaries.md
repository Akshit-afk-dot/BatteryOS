# 0002 — How the AI is allowed to participate

**Status:** accepted

## Context

The brief requires that the AI never invents measurements, results, certifications or history; that every important
statement is traceable; that it cannot approve, send, delete or change measured data; and that permissions are never
enforced by the language model.

## Decision

1. **The model never writes to the database.** Report and quotation drafts are returned to the server, validated and
   stored as drafts; the assistant's only "write" tools return proposals the user must apply.
2. **Inputs are explicit.** Reports send only the evidence the user selected, frozen as a snapshot. Quotation drafting
   sends the approved report and catalogue items without prices.
3. **Outputs are constrained.** Structured outputs with JSON schemas; citations and catalogue IDs are enums of the
   allowed values; unknown values are dropped server-side anyway.
4. **Outputs are checked deterministically.** `grounding.py` flags numbers absent from the evidence, unknown or missing
   citations, safety/certification/fitness/remaining-life/value/final-decision wording, and SOH mentions without SOH
   evidence. Approval requires explicit acknowledgement of anything flagged, which is recorded in the audit log.
5. **Provenance is visible.** Every narrative section shows whether it is AI-drafted, AI-drafted and edited, template,
   or human-written; the reviewer conclusion is always human.
6. **Everything works without AI.** Template drafts, catalogue defaults and pattern-based intake extraction keep the
   workflow usable with no API key and make AI optional for pilots.
7. **Model and safety settings.** Default model `claude-opus-5-5` (configurable). Requests opt into server-side refusal
   fallback (`fallbacks: "default"`), refusals and truncation are surfaced as errors, and the template is used as the
   fallback path for reports.

## Consequences

The AI saves typing but cannot be the source of truth. Grounding checks are conservative (rounded or rescaled evidence
values pass; computed percentages do not), so reviewers will occasionally see flags on legitimate text.
