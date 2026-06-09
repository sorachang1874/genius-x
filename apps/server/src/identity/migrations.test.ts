/**
 * Migration + seed + runner verification against REAL Postgres semantics (PGlite =
 * Postgres-in-WASM, no docker needed). Executable form of the frozen contracts' preflights
 * (identity.md → Validation, enrollment.md → Validation & preflight) — a permanent CI gate.
 *
 * The suite drives the SAME runner library (migrate.ts) the production CLI uses, so the
 * journaling/checksum/rollback path is covered too — not just the raw SQL.
 *
 * Known skew: PGlite 0.5.x embeds Postgres 18 while deploy targets postgres:16 (compose).
 * Current SQL is PG14-safe; the real-PG smoke is `migrate:seed` against the compose DB
 * (see migrations/README.md → Verify).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { DEFAULT_DEMO_TENANT_ID } from "../http";
import { applyMigrations, applySeeds, sha256, type MigrationFile, type SqlClient } from "./migrate";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");
const migration: MigrationFile = {
  name: "001_phase1_identity.sql",
  sql: readFileSync(join(MIGRATIONS_DIR, "001_phase1_identity.sql"), "utf8"),
};
const seed: MigrationFile = {
  name: "001_phase1_identity_seed.sql",
  sql: readFileSync(join(MIGRATIONS_DIR, "001_phase1_identity_seed.sql"), "utf8"),
};

// Seed fixtures (001_phase1_identity_seed.sql)
const SEED_STUDENTS = [
  "33333333-3333-4333-8333-000000000001",
  "33333333-3333-4333-8333-000000000002",
  "33333333-3333-4333-8333-000000000003",
  "33333333-3333-4333-8333-000000000004",
];
const PARENT_1 = "22222222-2222-4222-8222-000000000001";
const PARENT_2 = "22222222-2222-4222-8222-000000000002";
const TENANT_B = "99999999-9999-4999-8999-999999999999"; // second tenant created in tests
const CAPACITY_OK = '{"maxStudents": 100, "maxConcurrentSessions": 2}';

const quiet = (): void => {};

function adapter(db: PGlite): SqlClient {
  return {
    query: async (text, params) => db.query(text, params as never[]),
    exec: (text) => db.exec(text),
  };
}

let db: PGlite;
let sql: SqlClient;

async function count(text: string, params?: unknown[]): Promise<number> {
  const res = await sql.query(text, params);
  return (res.rows[0] as { n: number }).n;
}

beforeAll(async () => {
  db = new PGlite(); // fresh in-memory Postgres
  sql = adapter(db);
  await applyMigrations(sql, [migration], quiet); // same path as the production CLI
  await applySeeds(sql, [seed], quiet);
});

describe("001_phase1_identity migration + seed (via the runner)", () => {
  it("applies via the runner, journals with checksum, and seeds 4 students", async () => {
    const journal = await sql.query("SELECT filename, checksum FROM schema_migrations");
    expect(journal.rows).toEqual([{ filename: migration.name, checksum: sha256(migration.sql) }]);
    expect(await count("SELECT COUNT(*)::int AS n FROM tenants WHERE id = $1", [DEFAULT_DEMO_TENANT_ID])).toBe(1);
    expect(await count("SELECT COUNT(*)::int AS n FROM parents WHERE id = ANY($1)", [[PARENT_1, PARENT_2]])).toBe(2);
    expect(await count("SELECT COUNT(*)::int AS n FROM students WHERE id = ANY($1)", [SEED_STUDENTS])).toBe(4); // handbook DoD
    expect(await count("SELECT COUNT(*)::int AS n FROM guardian_consents WHERE student_id = ANY($1)", [SEED_STUDENTS])).toBe(4);
  });

  it("seed demo tenant id matches the server's DEFAULT_DEMO_TENANT_ID (drift gate)", async () => {
    const res = await sql.query("SELECT capacity FROM tenants WHERE id = $1", [DEFAULT_DEMO_TENANT_ID]);
    expect(res.rows).toHaveLength(1);
    // Tenant-level ENROLLMENT ceiling — not the per-classroom PREMIUM_CLASSROOM cap.
    const capacity = (res.rows[0] as { capacity: { maxStudents: number; maxConcurrentSessions: number } }).capacity;
    expect(capacity.maxStudents).toBeGreaterThan(0);
    expect(capacity.maxConcurrentSessions).toBeGreaterThan(0);
  });

  it("re-applying is safe: migration skips via journal, seed is idempotent", async () => {
    await applyMigrations(sql, [migration], quiet); // skip path (checksum match)
    await applySeeds(sql, [seed], quiet); // ON CONFLICT DO NOTHING
    expect(await count("SELECT COUNT(*)::int AS n FROM students WHERE id = ANY($1)", [SEED_STUDENTS])).toBe(4);
    expect(await count("SELECT COUNT(*)::int AS n FROM guardian_consents WHERE student_id = ANY($1)", [SEED_STUDENTS])).toBe(4);
  });

  // --- contract preflights (identity.md → Validation; enrollment.md → preflight) ---

  it("preflight: no orphan FKs, one consent per student, student/parent tenant match", async () => {
    expect(
      await count("SELECT COUNT(*)::int AS n FROM students WHERE tenant_id NOT IN (SELECT id FROM tenants)"),
    ).toBe(0);
    expect(
      await count("SELECT COUNT(*)::int AS n FROM students WHERE parent_id NOT IN (SELECT id FROM parents)"),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM students s WHERE NOT EXISTS (SELECT 1 FROM guardian_consents gc WHERE gc.student_id = s.id)",
      ),
    ).toBe(0);
    expect(
      await count(
        "SELECT COUNT(*)::int AS n FROM students s JOIN parents p ON s.parent_id = p.id WHERE s.tenant_id != p.tenant_id",
      ),
    ).toBe(0);
  });

  // --- DB-enforced contract rules (must reject invalid state, not rely on app code) ---

  it("rejects age outside 4-10 (INVALID_AGE boundary)", async () => {
    for (const age of [3, 11]) {
      await expect(
        sql.query("INSERT INTO students (tenant_id, parent_id, display_name, age) VALUES ($1, $2, '测试', $3)", [
          DEFAULT_DEMO_TENANT_ID,
          PARENT_1,
          age,
        ]),
      ).rejects.toThrow(/check constraint/i);
    }
  });

  it("rejects blank display_name (stricter than the contract preflight: space-only too)", async () => {
    await expect(
      sql.query("INSERT INTO students (tenant_id, parent_id, display_name, age) VALUES ($1, $2, '   ', 7)", [
        DEFAULT_DEMO_TENANT_ID,
        PARENT_1,
      ]),
    ).rejects.toThrow(/check constraint/i);
  });

  it("rejects current_phase outside 1-4 (Manifesto growth arc)", async () => {
    await expect(
      sql.query(
        "INSERT INTO students (tenant_id, parent_id, display_name, age, current_phase) VALUES ($1, $2, '测试', 7, 5)",
        [DEFAULT_DEMO_TENANT_ID, PARENT_1],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("rejects NULL elements in progress arrays (contract type is string[])", async () => {
    await expect(
      sql.query("UPDATE students SET badges = ARRAY[NULL]::text[] WHERE id = $1", [SEED_STUDENTS[0]]),
    ).rejects.toThrow(/check constraint/i);
  });

  it("rejects a second consent row for the same student (UNIQUE student_id)", async () => {
    await expect(
      sql.query(
        "INSERT INTO guardian_consents (student_id, parent_id, consent_version, data_retention_agreed) VALUES ($1, $2, 'v1.1', TRUE)",
        [SEED_STUDENTS[0], PARENT_1],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("rejects consent omitting data_retention_agreed (no DEFAULT — explicit affirmation only)", async () => {
    const s = await sql.query(
      "INSERT INTO students (tenant_id, parent_id, display_name, age) VALUES ($1, $2, '缺省测试', 7) RETURNING id",
      [DEFAULT_DEMO_TENANT_ID, PARENT_1],
    );
    const sid = (s.rows[0] as { id: string }).id;
    try {
      await expect(
        sql.query("INSERT INTO guardian_consents (student_id, parent_id, consent_version) VALUES ($1, $2, 'v1.0')", [
          sid,
          PARENT_1,
        ]),
      ).rejects.toThrow(/null value|not-null/i);
    } finally {
      await sql.query("DELETE FROM students WHERE id = $1", [sid]);
    }
  });

  it("rejects consent with data_retention_agreed = false (CONSENT_REQUIRED is invalid state)", async () => {
    const s = await sql.query(
      "INSERT INTO students (tenant_id, parent_id, display_name, age) VALUES ($1, $2, '未同意', 7) RETURNING id",
      [DEFAULT_DEMO_TENANT_ID, PARENT_1],
    );
    const sid = (s.rows[0] as { id: string }).id;
    try {
      await expect(
        sql.query(
          "INSERT INTO guardian_consents (student_id, parent_id, consent_version, data_retention_agreed) VALUES ($1, $2, 'v1.0', FALSE)",
          [sid, PARENT_1],
        ),
      ).rejects.toThrow(/check constraint/i);
    } finally {
      await sql.query("DELETE FROM students WHERE id = $1", [sid]);
    }
  });

  it("GUARDIANSHIP INTEGRITY: consent naming a parent other than the student's own is rejected", async () => {
    const s = await sql.query(
      "INSERT INTO students (tenant_id, parent_id, display_name, age) VALUES ($1, $2, '错位监护', 7) RETURNING id",
      [DEFAULT_DEMO_TENANT_ID, PARENT_1],
    );
    const sid = (s.rows[0] as { id: string }).id;
    try {
      await expect(
        sql.query(
          "INSERT INTO guardian_consents (student_id, parent_id, consent_version, data_retention_agreed) VALUES ($1, $2, 'v1.0', TRUE)",
          [sid, PARENT_2], // student belongs to PARENT_1
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await sql.query("DELETE FROM students WHERE id = $1", [sid]);
    }
  });

  it("rejects duplicate parent phone within a tenant (drives POST /parents idempotency)", async () => {
    await expect(
      sql.query("INSERT INTO parents (tenant_id, phone_number) VALUES ($1, '+8613800000001')", [
        DEFAULT_DEMO_TENANT_ID,
      ]),
    ).rejects.toThrow(/unique|duplicate/i);
  });

  it("rejects empty-string parent identifiers (they are idempotency keys, '' would collide)", async () => {
    await expect(
      sql.query("INSERT INTO parents (tenant_id, phone_number) VALUES ($1, '')", [DEFAULT_DEMO_TENANT_ID]),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      sql.query("INSERT INTO parents (tenant_id, wechat_open_id) VALUES ($1, '')", [DEFAULT_DEMO_TENANT_ID]),
    ).rejects.toThrow(/check constraint/i);
  });

  it("allows multiple parents with NULL phone/wechat (NULLs are distinct)", async () => {
    await sql.query("INSERT INTO parents (tenant_id) VALUES ($1)", [DEFAULT_DEMO_TENANT_ID]);
    await sql.query("INSERT INTO parents (tenant_id) VALUES ($1)", [DEFAULT_DEMO_TENANT_ID]);
    expect(
      await count("SELECT COUNT(*)::int AS n FROM parents WHERE phone_number IS NULL AND wechat_open_id IS NULL"),
    ).toBeGreaterThanOrEqual(2);
  });

  it("rejects contract-illegal tenant capacity shapes (NULL-safe JSONB CHECK)", async () => {
    for (const bad of [`'{}'`, `'null'`, `'[1,2]'`, `'"scalar"'`, `'{"maxStudents": 10}'`]) {
      await expect(
        db.exec(`INSERT INTO tenants (name, type, region, capacity) VALUES ('坏容量', 'city', 'cn-east', ${bad})`),
      ).rejects.toThrow(/check constraint/i);
    }
    // Omission fails loudly too (no DEFAULT).
    await expect(
      db.exec(`INSERT INTO tenants (name, type, region) VALUES ('无容量', 'city', 'cn-east')`),
    ).rejects.toThrow(/null value|not-null/i);
  });

  it("rejects non-object tenant config", async () => {
    await expect(
      db.exec(`INSERT INTO tenants (name, type, region, config, capacity) VALUES ('坏配置', 'city', 'cn-east', '[]', '${CAPACITY_OK}')`),
    ).rejects.toThrow(/check constraint/i);
  });

  it("DATA-LAYER TENANT ISOLATION: a student cannot reference a parent from another tenant", async () => {
    await sql.query("INSERT INTO tenants (id, name, type, region, capacity) VALUES ($1, 'Tenant B', 'city', 'cn-east', $2)", [
      TENANT_B,
      CAPACITY_OK,
    ]);
    // Parent lives in tenant B; trying to enroll a student under DEMO tenant with that parent
    // must violate the composite FK (parent_id, tenant_id) → parents(id, tenant_id).
    const parentB = await sql.query(
      "INSERT INTO parents (tenant_id, phone_number) VALUES ($1, '+8613800000099') RETURNING id",
      [TENANT_B],
    );
    await expect(
      sql.query("INSERT INTO students (tenant_id, parent_id, display_name, age) VALUES ($1, $2, '越界', 7)", [
        DEFAULT_DEMO_TENANT_ID,
        (parentB.rows[0] as { id: string }).id,
      ]),
    ).rejects.toThrow(/foreign key/i);
  });

  it("deleting a student cascades its consent (ON DELETE CASCADE on the composite FK)", async () => {
    const inserted = await sql.query(
      "INSERT INTO students (tenant_id, parent_id, display_name, age) VALUES ($1, $2, '临时', 8) RETURNING id",
      [DEFAULT_DEMO_TENANT_ID, PARENT_1],
    );
    const sid = (inserted.rows[0] as { id: string }).id;
    await sql.query(
      "INSERT INTO guardian_consents (student_id, parent_id, consent_version, data_retention_agreed) VALUES ($1, $2, 'v1.0', TRUE)",
      [sid, PARENT_1],
    );
    await sql.query("DELETE FROM students WHERE id = $1", [sid]);
    expect(await count("SELECT COUNT(*)::int AS n FROM guardian_consents WHERE student_id = $1", [sid])).toBe(0);
  });
});

// --- runner behavior (fresh databases — journaling, checksum guard, rollback) ---

describe("migrate runner (applyMigrations/applySeeds)", () => {
  it("ABORTS loudly when an applied migration file was edited (checksum guard)", async () => {
    const fresh = adapter(new PGlite());
    await applyMigrations(fresh, [migration], quiet);
    const edited: MigrationFile = { name: migration.name, sql: migration.sql + "\n-- edited after apply" };
    await expect(applyMigrations(fresh, [edited], quiet)).rejects.toThrow(/EDITED|checksum/);
  });

  it("rolls back a failing migration atomically: no partial schema, no journal row", async () => {
    const fresh = adapter(new PGlite());
    const bad: MigrationFile = {
      name: "002_bad.sql",
      sql: "CREATE TABLE will_rollback (id INT);\nINSERT INTO does_not_exist VALUES (1);",
    };
    await expect(applyMigrations(fresh, [migration, bad], quiet)).rejects.toThrow(/FAILED 002_bad/);
    const reg = await fresh.query("SELECT to_regclass('will_rollback') AS t");
    expect((reg.rows[0] as { t: string | null }).t).toBeNull(); // rolled back with the tx
    const journal = await fresh.query("SELECT filename FROM schema_migrations");
    expect(journal.rows).toEqual([{ filename: migration.name }]); // 001 applied, 002 not journaled
  });

  it("backfills checksums for legacy journals (pre-checksum schema_migrations)", async () => {
    const freshDb = new PGlite();
    const fresh = adapter(freshDb);
    // Simulate a DB migrated by the pre-checksum runner: apply SQL raw + journal w/o checksum.
    await freshDb.exec(migration.sql);
    await freshDb.exec(
      `CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
       INSERT INTO schema_migrations (filename) VALUES ('${migration.name}');`,
    );
    await applyMigrations(fresh, [migration], quiet); // must skip + backfill, not re-apply
    const journal = await fresh.query("SELECT checksum FROM schema_migrations WHERE filename = $1", [migration.name]);
    expect((journal.rows[0] as { checksum: string }).checksum).toBe(sha256(migration.sql));
  });
});
