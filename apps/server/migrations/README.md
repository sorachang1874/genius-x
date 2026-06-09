# Migrations — @genius-x/server

PostgreSQL schema for the persistent layer (Phase 1+: identity & enrollment). The schema is
the storage realization of the **frozen contracts** — `docs/contracts/identity.md`,
`docs/contracts/enrollment.md`, typed in `packages/contracts/src/identity.ts` /
`enrollment.ts`. Schema changes are contract changes: re-serialize through the lead.

## Files

| File | What | Journaled |
| --- | --- | --- |
| `001_phase1_identity.sql` | tenants, parents, students, guardian_consents + CHECKs/indexes | yes (`schema_migrations`, with sha256 checksum) |
| `001_phase1_identity_seed.sql` | demo tenant (`11111111-…`), 2 test parents, 4 test students + consents | no — dev/test only, idempotent, re-runnable |

Migration files contain **no `BEGIN/COMMIT`** — the runner (library: `src/identity/migrate.ts`,
CLI: `scripts/migrate.ts`) wraps each file plus its journal row in one transaction (atomic
apply-or-skip), serialized by an advisory lock.

**Never edit an applied migration.** The journal stores a sha256 checksum; if an applied
file's content changes, the next run **aborts loudly** instead of silently skipping a
drifted file. Author a new `NNN_*.sql` instead.

**Seed guard**: `--seed` refuses to run when `GENIUS_X_MODE` is `live`/`production` (or
`NODE_ENV=production`) unless `ALLOW_SEED=1` is set explicitly — the seed is fixed,
publicly-known demo data.

## Apply

```bash
# 1. Start local Postgres (docker-compose.yml: geniusx/geniusx@localhost:5432/geniusx)
docker compose up -d postgres

# 2. Apply migrations (+ seed for dev)
DATABASE_URL=postgres://geniusx:geniusx@localhost:5432/geniusx \
  pnpm --filter @genius-x/server migrate:seed

# Production: migrations only, no seed
DATABASE_URL=... pnpm --filter @genius-x/server migrate
```

## Verify

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM students;"   # 4 (seeded)
# Contract preflights (expect 0):
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM students WHERE tenant_id NOT IN (SELECT id FROM tenants);"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM students s WHERE NOT EXISTS (SELECT 1 FROM guardian_consents gc WHERE gc.student_id = s.id);"
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM students s JOIN parents p ON s.parent_id = p.id WHERE s.tenant_id != p.tenant_id;"
```

**No docker/psql needed for CI**: `src/identity/migrations.test.ts` drives the SAME runner
library against PGlite (Postgres-in-WASM) on every `pnpm test` and asserts the preflights,
every DB-enforced contract rule (age 4-10, blank-name rejection, one-consent-per-student,
retention CHECK, guardianship-match FK, parent uniqueness, capacity/config JSONB shape,
cross-tenant composite-FK isolation, cascade) AND the runner behavior (checksum abort,
atomic rollback, legacy-journal backfill).

**Version skew (documented)**: PGlite 0.5.x embeds Postgres **18**, the deploy target is
postgres:**16** (compose), and the migration header promises 14+. Current SQL is 14-safe;
the **real-PG smoke** is running `migrate:seed` + the Verify queries above against the
compose postgres:16 whenever a migration changes.

## Rollback

Migrations are **forward-only** (intentional Phase-1 decision). There are no down files.

- **Dev**: wipe and re-apply —
  ```bash
  docker compose down -v && docker compose up -d postgres
  DATABASE_URL=... pnpm --filter @genius-x/server migrate:seed
  ```
- **Production**: restore from backup, or author a NEW forward migration that undoes the
  change. Never edit an applied file — the checksum guard will abort the runner if you do.

## Design notes

- **Tenant isolation at the data layer**: `students(parent_id, tenant_id)` is a composite FK
  to `parents(id, tenant_id)` — a student physically cannot reference a parent in another
  tenant (identity.md → Tenant isolation).
- **Guardianship integrity**: `guardian_consents(student_id, parent_id)` is a composite FK to
  `students(id, parent_id)` — the consenting parent must be the student's own enrolling
  parent (Phase 1: single parent; multi-parent is a documented future extension).
- **Consent has no DEFAULT for `data_retention_agreed`** — consent is an explicit legal
  affirmation; omission fails loudly rather than being recorded as agreement.
- **`updated_at` is app-managed** (Identity Service sets it on UPDATE); no triggers.
- **No soft-delete `status`** on students/parents — deferred to Phase 8 with the deletion
  flow (identity.md → Lifecycle). Only `tenants.status` exists in Phase 1.
- **Demo tenant id** must stay in sync with `DEFAULT_DEMO_TENANT_ID` in `src/http.ts` —
  enforced by the migration test (drift gate).
