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
const migration002: MigrationFile = {
  name: "002_phase2_workspace.sql",
  sql: readFileSync(join(MIGRATIONS_DIR, "002_phase2_workspace.sql"), "utf8"),
};
const migration003: MigrationFile = {
  name: "003_phase3_share_tokens.sql",
  sql: readFileSync(join(MIGRATIONS_DIR, "003_phase3_share_tokens.sql"), "utf8"),
};
const migration004: MigrationFile = {
  name: "004_phase4_interaction_safety.sql",
  sql: readFileSync(join(MIGRATIONS_DIR, "004_phase4_interaction_safety.sql"), "utf8"),
};
const migration005: MigrationFile = {
  name: "005_phase45_ip_character.sql",
  sql: readFileSync(join(MIGRATIONS_DIR, "005_phase45_ip_character.sql"), "utf8"),
};
const migration006: MigrationFile = {
  name: "006_phase6_parent_surface.sql",
  sql: readFileSync(join(MIGRATIONS_DIR, "006_phase6_parent_surface.sql"), "utf8"),
};
const migration007: MigrationFile = {
  name: "007_consent_ip_physical_use.sql",
  sql: readFileSync(join(MIGRATIONS_DIR, "007_consent_ip_physical_use.sql"), "utf8"),
};
const migration008: MigrationFile = {
  name: "008_playground_session_tokens.sql",
  sql: readFileSync(join(MIGRATIONS_DIR, "008_playground_session_tokens.sql"), "utf8"),
};
const migration009: MigrationFile = {
  name: "009_memories_seq_diary_unique.sql",
  sql: readFileSync(join(MIGRATIONS_DIR, "009_memories_seq_diary_unique.sql"), "utf8"),
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
  await applyMigrations(sql, [migration, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009], quiet); // same path as the production CLI
  await applySeeds(sql, [seed], quiet);
});

describe("001_phase1_identity migration + seed (via the runner)", () => {
  it("applies via the runner, journals with checksum, and seeds 4 students", async () => {
    const journal = await sql.query("SELECT filename, checksum FROM schema_migrations ORDER BY filename");
    expect(journal.rows).toEqual([
      { filename: migration.name, checksum: sha256(migration.sql) },
      { filename: migration002.name, checksum: sha256(migration002.sql) },
      { filename: migration003.name, checksum: sha256(migration003.sql) },
      { filename: migration004.name, checksum: sha256(migration004.sql) },
      { filename: migration005.name, checksum: sha256(migration005.sql) },
      { filename: migration006.name, checksum: sha256(migration006.sql) },
      { filename: migration007.name, checksum: sha256(migration007.sql) },
      { filename: migration008.name, checksum: sha256(migration008.sql) },
      { filename: migration009.name, checksum: sha256(migration009.sql) },
    ]);
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
    await applyMigrations(sql, [migration, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009], quiet); // skip path (checksum match)
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
  }, 30_000); // fresh-PGlite boot on a cold CI runner can exceed the 5s default

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

// --- Phase 2 (002_phase2_workspace): DB-enforced workspace contract rules ---

describe("002_phase2_workspace migration", () => {
  const XIAOMING = "33333333-3333-4333-8333-000000000001"; // seeded, demo tenant

  it("DATA-LAYER TENANT ISOLATION: a workspace row cannot claim another tenant", async () => {
    await expect(
      sql.query(
        "INSERT INTO works (student_id, tenant_id, type, content_text, lesson_id, stage_id, degraded) VALUES ($1, $2, 'avatar_image', 'x', 'lesson-001', 'shape', false)",
        [XIAOMING, TENANT_B], // 小明 belongs to the demo tenant, not TENANT_B
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it("rejects empty works (no content fields at all)", async () => {
    await expect(
      sql.query(
        "INSERT INTO works (student_id, tenant_id, type, lesson_id, stage_id, degraded) VALUES ($1, $2, 'avatar_image', 'lesson-001', 'shape', false)",
        [XIAOMING, DEFAULT_DEMO_TENANT_ID],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("rejects oversized refs (refs are references, never payloads)", async () => {
    await expect(
      sql.query(
        `INSERT INTO interactions (student_id, tenant_id, occurred_at, lesson_id, stage_id, initiated_by, input_kind, input_ref, output_kind, output_degraded)
         VALUES ($1, $2, NOW(), 'lesson-001', 'talent', 'student', 'voice', $3, 'text', false)`,
        [XIAOMING, DEFAULT_DEMO_TENANT_ID, "r".repeat(513)],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("rejects unknown initiated_by and out-of-range importance", async () => {
    await expect(
      sql.query(
        `INSERT INTO interactions (student_id, tenant_id, occurred_at, lesson_id, stage_id, initiated_by, input_kind, output_kind, output_degraded)
         VALUES ($1, $2, NOW(), 'lesson-001', 'talent', 'alien', 'voice', 'text', false)`,
        [XIAOMING, DEFAULT_DEMO_TENANT_ID],
      ),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      sql.query(
        "INSERT INTO memories (student_id, tenant_id, key, value, lesson_id, stage_id, importance) VALUES ($1, $2, 'favorite_toy', '积木', 'lesson-001', 'talent', 1.5)",
        [XIAOMING, DEFAULT_DEMO_TENANT_ID],
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("contract preflights hold (tenant match across all three tables)", async () => {
    // Insert one legal row per table, then run the workspace.md preflights.
    const work = await sql.query(
      "INSERT INTO works (student_id, tenant_id, type, content_url, lesson_id, stage_id, degraded) VALUES ($1, $2, 'avatar_image', 'fake://a.png', 'lesson-001', 'shape', false) RETURNING id",
      [XIAOMING, DEFAULT_DEMO_TENANT_ID],
    );
    const interaction = await sql.query(
      `INSERT INTO interactions (student_id, tenant_id, occurred_at, lesson_id, stage_id, initiated_by, input_kind, input_text, output_kind, output_text, output_work_id, output_degraded)
       VALUES ($1, $2, NOW(), 'lesson-001', 'shape', 'student', 'doodle', '画了一个圆', 'images', NULL, $3, false) RETURNING id`,
      [XIAOMING, DEFAULT_DEMO_TENANT_ID, (work.rows[0] as { id: string }).id],
    );
    await sql.query(
      "INSERT INTO memories (student_id, tenant_id, key, value, lesson_id, stage_id, source_interaction_id) VALUES ($1, $2, 'favorite_toy', '积木', 'lesson-001', 'talent', $3)",
      [XIAOMING, DEFAULT_DEMO_TENANT_ID, (interaction.rows[0] as { id: string }).id],
    );
    for (const table of ["works", "interactions", "memories"]) {
      expect(
        await count(
          `SELECT COUNT(*)::int AS n FROM ${table} t JOIN students s ON t.student_id = s.id WHERE t.tenant_id != s.tenant_id`,
        ),
      ).toBe(0);
    }
    expect(
      await count("SELECT COUNT(*)::int AS n FROM works WHERE content_url IS NULL AND content_text IS NULL AND content_json IS NULL"),
    ).toBe(0);
  });
});

// --- 002 review mandates: student-scoped pointers + hardening probes ---

describe("002 cross-row pointer isolation (review blocker)", () => {
  const XIAOMING = "33333333-3333-4333-8333-000000000001";
  const DUODUO = "33333333-3333-4333-8333-000000000002";

  it("an interaction CANNOT reference another student's work", async () => {
    const w = await sql.query(
      "INSERT INTO works (student_id, tenant_id, type, content_text, lesson_id, stage_id, degraded) VALUES ($1, $2, 't', 'x', 'lesson-001', 'shape', false) RETURNING id",
      [XIAOMING, DEFAULT_DEMO_TENANT_ID],
    );
    await expect(
      sql.query(
        `INSERT INTO interactions (student_id, tenant_id, occurred_at, lesson_id, stage_id, initiated_by, input_kind, input_text, output_kind, output_work_id, output_degraded)
         VALUES ($1, $2, NOW(), 'lesson-001', 'shape', 'student', 'doodle', 'x', 'images', $3, false)`,
        [DUODUO, DEFAULT_DEMO_TENANT_ID, (w.rows[0] as { id: string }).id], // 朵朵 → 小明's work
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it("a memory CANNOT reference another student's interaction", async () => {
    const i = await sql.query(
      `INSERT INTO interactions (student_id, tenant_id, occurred_at, lesson_id, stage_id, initiated_by, input_kind, input_text, output_kind, output_degraded)
       VALUES ($1, $2, NOW(), 'lesson-001', 'talent', 'student', 'voice', 'x', 'text', false) RETURNING id`,
      [XIAOMING, DEFAULT_DEMO_TENANT_ID],
    );
    await expect(
      sql.query(
        "INSERT INTO memories (student_id, tenant_id, key, value, lesson_id, stage_id, source_interaction_id) VALUES ($1, $2, 'k', 'v', 'lesson-001', 'talent', $3)",
        [DUODUO, DEFAULT_DEMO_TENANT_ID, (i.rows[0] as { id: string }).id],
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it("memoriesExtracted LATERAL preflight: every linked id exists AND belongs to the same student", async () => {
    expect(
      await count(
        `SELECT COUNT(*)::int AS n FROM interactions i CROSS JOIN LATERAL unnest(i.memories_extracted) mid
         WHERE NOT EXISTS (SELECT 1 FROM memories m WHERE m.id = mid AND m.student_id = i.student_id)`,
      ),
    ).toBe(0);
  });
});

describe("002 hardening probes (review mandates)", () => {
  const XIAOMING = "33333333-3333-4333-8333-000000000001";

  it("rejects: NULL array elements, 1970 occurred_at, '' session_id, omitted initiated_by", async () => {
    const i = await sql.query(
      `INSERT INTO interactions (student_id, tenant_id, occurred_at, lesson_id, stage_id, initiated_by, input_kind, input_text, output_kind, output_degraded)
       VALUES ($1, $2, NOW(), 'lesson-001', 'talent', 'student', 'voice', 'probe', 'text', false) RETURNING id`,
      [XIAOMING, DEFAULT_DEMO_TENANT_ID],
    );
    await expect(
      sql.query("UPDATE interactions SET memories_extracted = ARRAY[NULL]::uuid[] WHERE id = $1", [
        (i.rows[0] as { id: string }).id,
      ]),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      sql.query(
        `INSERT INTO interactions (student_id, tenant_id, occurred_at, lesson_id, stage_id, initiated_by, input_kind, output_kind, output_degraded)
         VALUES ($1, $2, '1970-01-01', 'lesson-001', 'talent', 'student', 'voice', 'text', false)`,
        [XIAOMING, DEFAULT_DEMO_TENANT_ID],
      ),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      sql.query(
        `INSERT INTO interactions (student_id, tenant_id, occurred_at, lesson_id, stage_id, session_id, initiated_by, input_kind, output_kind, output_degraded)
         VALUES ($1, $2, NOW(), 'lesson-001', 'talent', '', 'student', 'voice', 'text', false)`,
        [XIAOMING, DEFAULT_DEMO_TENANT_ID],
      ),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      sql.query(
        `INSERT INTO interactions (student_id, tenant_id, occurred_at, lesson_id, stage_id, input_kind, output_kind, output_degraded)
         VALUES ($1, $2, NOW(), 'lesson-001', 'talent', 'voice', 'text', false)`,
        [XIAOMING, DEFAULT_DEMO_TENANT_ID],
      ),
    ).rejects.toThrow(/not-null/i);
  });

  it("rejects an oversized content_json blob (refs-never-bytes cannot be bypassed via JSONB)", async () => {
    const blob = JSON.stringify({ data: "x".repeat(100000) });
    await expect(
      db.exec(
        `INSERT INTO works (student_id, tenant_id, type, content_json, lesson_id, stage_id, degraded)
         VALUES ('${XIAOMING}', '${DEFAULT_DEMO_TENANT_ID}', 't', '${blob}'::jsonb, 'lesson-001', 'shape', false)`,
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it("UPGRADE PATH: 002's ALTER lands on a 001-journaled, SEEDED database (the prod sequence)", async () => {
    const freshDb = new PGlite();
    const fresh = {
      query: async (text: string, params?: unknown[]) => freshDb.query(text, params as never[]),
      exec: (text: string) => freshDb.exec(text),
    };
    await applyMigrations(fresh, [migration], quiet); // 001 alone, journaled
    await applySeeds(fresh, [seed], quiet); // populated students
    await applyMigrations(fresh, [migration, migration002], quiet); // then the upgrade
    const journal = await fresh.query("SELECT filename FROM schema_migrations ORDER BY filename");
    expect((journal.rows as { filename: string }[]).map((r) => r.filename)).toEqual([migration.name, migration002.name]);
    const tables = await fresh.query(
      "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name IN ('works','interactions','memories')",
    );
    expect((tables.rows[0] as { n: number }).n).toBe(3);
  });
});

describe("003_phase3_share_tokens migration", () => {
  const XIAOMING = "33333333-3333-4333-8333-000000000001";
  const HASH = "a".repeat(64);

  it("hash-shape CHECK + expiry sanity + tenant composite FK enforced", async () => {
    await expect(
      sql.query(
        "INSERT INTO share_tokens (token_hash, student_id, tenant_id, lesson_id, expires_at) VALUES ('raw-token-not-a-hash', $1, $2, 'lesson-001', NOW() + INTERVAL '1 day')",
        [XIAOMING, DEFAULT_DEMO_TENANT_ID],
      ),
    ).rejects.toThrow(/check constraint/i); // only sha256 hex shapes persist
    await expect(
      sql.query(
        "INSERT INTO share_tokens (token_hash, student_id, tenant_id, lesson_id, expires_at) VALUES ($3, $1, $2, 'lesson-001', NOW() - INTERVAL '1 day')",
        [XIAOMING, DEFAULT_DEMO_TENANT_ID, HASH],
      ),
    ).rejects.toThrow(/check constraint/i); // expiry must be after creation
    await expect(
      sql.query(
        "INSERT INTO share_tokens (token_hash, student_id, tenant_id, lesson_id, expires_at) VALUES ($3, $1, $2, 'lesson-001', NOW() + INTERVAL '1 day')",
        [XIAOMING, TENANT_B, HASH],
      ),
    ).rejects.toThrow(/foreign key/i); // cross-tenant claim impossible
    // contract preflight: hashes only
    await sql.query(
      "INSERT INTO share_tokens (token_hash, student_id, tenant_id, lesson_id, expires_at) VALUES ($3, $1, $2, 'lesson-001', NOW() + INTERVAL '1 day')",
      [XIAOMING, DEFAULT_DEMO_TENANT_ID, HASH],
    );
    expect(await count("SELECT COUNT(*)::int AS n FROM share_tokens WHERE length(token_hash) != 64")).toBe(0);
  });
});
