/**
 * Migration library — the testable core of the migrate runner (CLI: scripts/migrate.ts).
 *
 * Guarantees:
 *   * Each migration file + its schema_migrations journal row apply in ONE transaction —
 *     atomic apply-or-skip, never half-applied. (Files contain no BEGIN/COMMIT.)
 *   * The journal records a sha256 CHECKSUM. Editing an already-applied file is detected
 *     on the next run and ABORTS loudly — never edit an applied migration; author a new
 *     file. (PGlite CI always applies current file content, so without this guard a real
 *     DB would silently drift while CI stays green.)
 *   * A session-level advisory lock serializes concurrent runners (released on disconnect).
 *   * Seed files (`*_seed.sql`) are dev/test data: idempotent, re-runnable, never journaled.
 *
 * Driven by the PGlite test suite (migrations.test.ts) and by the pg CLI — both through
 * the minimal SqlClient interface below.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SqlClient {
  /** Single parameterized statement (extended protocol). */
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  /** Multi-statement script — migration file contents (simple protocol). */
  exec(sql: string): Promise<unknown>;
}

export interface MigrationFile {
  name: string;
  sql: string;
}

export type Log = (message: string) => void;

/** Fixed advisory-lock key for the migration runner (arbitrary but stable). */
const MIGRATE_LOCK_KEY = 727274001;

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Load *.sql files from a directory, split into journaled migrations and re-runnable seeds. */
export function loadMigrationFiles(dir: string): { migrations: MigrationFile[]; seeds: MigrationFile[] } {
  const all = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
  return {
    migrations: all.filter((f) => !f.name.endsWith("_seed.sql")),
    seeds: all.filter((f) => f.name.endsWith("_seed.sql")),
  };
}

/** ROLLBACK that never masks the original error (a dead connection makes ROLLBACK throw too). */
async function safeRollback(client: SqlClient, log: Log): Promise<void> {
  try {
    await client.exec("ROLLBACK");
  } catch (err) {
    log(`[migrate] rollback failed (original error follows): ${(err as Error).message}`);
  }
}

export async function applyMigrations(client: SqlClient, files: MigrationFile[], log: Log = console.log): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       checksum TEXT
     )`,
  );
  // Legacy journals (pre-checksum) get the column added; NULL checksums are backfilled below.
  await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT");

  // Serialize concurrent runners (check-then-act below would otherwise race).
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATE_LOCK_KEY]);
  try {
    for (const file of files) {
      const checksum = sha256(file.sql);
      const journal = await client.query("SELECT checksum FROM schema_migrations WHERE filename = $1", [file.name]);
      if (journal.rows.length > 0) {
        const stored = (journal.rows[0] as { checksum: string | null }).checksum;
        if (stored === null) {
          // Legacy row from before the checksum guard: backfill once, then guard from now on.
          await client.query("UPDATE schema_migrations SET checksum = $1 WHERE filename = $2", [checksum, file.name]);
          log(`[migrate] skip (applied; checksum backfilled): ${file.name}`);
        } else if (stored !== checksum) {
          throw new Error(
            `[migrate] ABORT: ${file.name} was EDITED after being applied (checksum mismatch). ` +
              `Never edit an applied migration — author a new NNN_*.sql file instead.`,
          );
        } else {
          log(`[migrate] skip (applied): ${file.name}`);
        }
        continue;
      }
      await client.exec("BEGIN");
      try {
        await client.exec(file.sql);
        await client.query("INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)", [
          file.name,
          checksum,
        ]);
        await client.exec("COMMIT");
        log(`[migrate] applied: ${file.name}`);
      } catch (err) {
        await safeRollback(client, log);
        throw new Error(`[migrate] FAILED ${file.name}: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATE_LOCK_KEY]);
  }
}

export async function applySeeds(client: SqlClient, files: MigrationFile[], log: Log = console.log): Promise<void> {
  for (const file of files) {
    await client.exec("BEGIN");
    try {
      await client.exec(file.sql);
      await client.exec("COMMIT");
      log(`[migrate] seeded: ${file.name} (idempotent, not journaled)`);
    } catch (err) {
      await safeRollback(client, log);
      throw new Error(`[migrate] SEED FAILED ${file.name}: ${(err as Error).message}`);
    }
  }
}
