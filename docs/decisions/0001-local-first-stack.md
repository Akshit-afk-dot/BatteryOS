# 0001 — Local-first stack instead of Supabase for the MVP

**Status:** accepted

## Context

The brief suggests Next.js, FastAPI, PostgreSQL/Supabase, Supabase Auth and Supabase Storage. The MVP has to run and be
testable on one laptop without accounts, keys or paid services, on a budget under ₹1 lakh.

## Decision

- **Database:** SQLAlchemy 2 + Alembic, SQLite by default, PostgreSQL via `DATABASE_URL`. Models avoid SQLite- or
  Postgres-only features (JSON columns, string IDs, UTC timestamps stored naive and re-tagged on read).
- **Auth:** built into the API — bcrypt password hashes (SHA-256 pre-hash so long passphrases work), opaque random
  session tokens stored only as hashes, `HttpOnly` `SameSite=Lax` cookies, server-side revocation, rate-limited login.
- **File storage:** local, content-addressed (`<org>/<sha[:2]>/<sha>`), read-only after write, behind a three-function
  interface (`put`, `get`, `verify`) so it can be replaced by S3 or Supabase Storage.

## Consequences

- Zero external dependencies to run, test or demo.
- Moving to Supabase later means: point `DATABASE_URL` at Supabase Postgres, swap `storage.py`, and either keep the
  built-in auth or replace `deps.get_session_user` with Supabase JWT verification.
- In-process rate limiting and local files mean one API instance until those are swapped.
