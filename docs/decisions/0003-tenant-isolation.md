# 0003 — Tenant isolation in the API layer

**Status:** accepted (revisit when moving to PostgreSQL)

## Context

One business must never see another's records (brief §8.9). The brief asks for enforcement in the backend and, where
supported, at the database policy layer.

## Decision

- Every business-owned table has `organization_id`.
- The active workspace comes from the server-side session, never from the request body.
- Single records are loaded only through `deps.get_scoped`, which filters on `organization_id` and returns 404 (not 403)
  so other workspaces' IDs are not revealed. Lists filter explicitly. Cross-references in request bodies (customer,
  batch, test session, catalogue item, report) are validated through the same helper.
- Content-addressed storage keys include the organization ID, so identical files in two workspaces are stored apart, and
  the "file also attached elsewhere" check only searches the current workspace.
- `tests/test_tenancy.py` attempts reads and writes on every record type across workspaces.

SQLite has no row-level security, so RLS is not configured yet.

## Consequences / next step

When running on PostgreSQL, add RLS policies on `organization_id` and set `app.org_id` per transaction from `get_ctx`,
so a missed filter in future code still cannot leak data.
