/**
 * TEST-ONLY support for identity tests (imported by *.test.ts files exclusively — PGlite is
 * a devDependency; production wiring uses createIdentityPool from db.ts instead).
 *
 * Boots a fresh in-memory Postgres (PGlite), applies the real migration through the SAME
 * runner library the production CLI uses, and exposes an IdentityService plus fixture
 * helpers. Same storage class and SQL files as production — no parallel fake.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { applyMigrations, applySeeds, loadMigrationFiles, type SqlClient } from "./migrate";
import { IdentityService, type IdentityDb } from "./service";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations");

export interface IdentityTestContext {
  db: PGlite;
  sql: SqlClient & IdentityDb;
  service: IdentityService;
  /** Insert a tenant with contract-legal capacity; returns its id. */
  makeTenant(name?: string): Promise<string>;
  /** Create a parent in the tenant via the service (no identifiers unless given). */
  makeParent(tenantId: string, opts?: { phoneNumber?: string; wechatOpenId?: string }): Promise<string>;
}

export async function newIdentityTestContext(opts: { seed?: boolean } = {}): Promise<IdentityTestContext> {
  const db = new PGlite();
  const sql: SqlClient & IdentityDb = {
    query: async (text, params) => db.query(text, params as never[]),
    exec: (text) => db.exec(text),
  };
  const { migrations, seeds } = loadMigrationFiles(MIGRATIONS_DIR);
  await applyMigrations(sql, migrations, () => {});
  if (opts.seed) await applySeeds(sql, seeds, () => {});

  const service = new IdentityService(sql);

  let tenantSeq = 0;
  const makeTenant = async (name = `测试租户-${++tenantSeq}`): Promise<string> => {
    const res = await sql.query(
      `INSERT INTO tenants (name, type, region, capacity)
       VALUES ($1, 'school', 'cn-north', '{"maxStudents": 1000, "maxConcurrentSessions": 5}')
       RETURNING id`,
      [name],
    );
    return (res.rows[0] as { id: string }).id;
  };

  const makeParent = async (
    tenantId: string,
    parentOpts: { phoneNumber?: string; wechatOpenId?: string } = {},
  ): Promise<string> => {
    const { parentId } = await service.createParent({ tenantId, ...parentOpts });
    return parentId;
  };

  return { db, sql, service, makeTenant, makeParent };
}

/** Re-read the seed file path (for tests that assert against seeded fixtures). */
export function readMigrationFile(name: string): string {
  return readFileSync(join(MIGRATIONS_DIR, name), "utf8");
}
