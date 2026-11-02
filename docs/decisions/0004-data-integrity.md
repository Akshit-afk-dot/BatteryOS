# 0004 — Raw data, derived data and corrections

**Status:** accepted

## Decision

- **Originals are immutable.** Uploads are stored once by SHA-256, made read-only, verified on every download, and have
  no delete or replace endpoint. Only their description and test-session link can change (audited).
- **Derived data is separate and reproducible.** A dataset records the exact parser options, column mapping (including
  whether each unit came from the header, the user, or an assumption), the full validation report and the warnings the
  importer acknowledged. Re-importing creates a new dataset and marks the old one superseded.
- **Calculated values say how.** Each metric stores its method; charge throughput is labelled as not being a capacity
  result unless the test was a controlled full discharge.
- **Results are never edited.** A wrong result is voided with a reason (kept, struck through, excluded from new reports)
  and a correct one recorded. "Measured" results must reference a test session so conditions exist.
- **Ambiguity blocks silent acceptance.** Unit assumptions, unconfirmed current sign and ambiguous date order are
  warnings that must be confirmed or acknowledged; structural problems are errors that block import.
- **Approved documents are locked.** Reports and quotations are versioned; edits after approval need a new revision, and
  each approval/status change is snapshotted.
