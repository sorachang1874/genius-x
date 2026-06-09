/**
 * Migration CLI — thin wrapper over src/identity/migrate.ts (the testable library).
 *
 *   pnpm --filter @genius-x/server migrate          # migrations only
 *   pnpm --filter @genius-x/server migrate:seed     # migrations + seed files (dev/test)
 *
 * Guards:
 *   * DATABASE_URL is required — fails closed with a clear message (config discipline).
 *   * --seed REFUSES to run when GENIUS_X_MODE is live/production or NODE_ENV=production,
 *     unless ALLOW_SEED=1 is set explicitly (the seed contains fixed, publicly-known demo
 *     UUIDs — never production data).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { applyMigrations, applySeeds, loadMigrationFiles, type SqlClient } from "../src/identity/migrate";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const LOCAL_EXAMPLE = "postgres://geniusx:geniusx@localhost:5432/geniusx";

async function main(): Promise<void> {
  const withSeed = process.argv.includes("--seed");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      `[migrate] Missing DATABASE_URL. For the local docker-compose Postgres use:\n` +
        `  DATABASE_URL=${LOCAL_EXAMPLE} pnpm --filter @genius-x/server migrate${withSeed ? ":seed" : ""}`,
    );
    process.exit(1);
  }

  const mode = process.env.GENIUS_X_MODE;
  const prodLike = mode === "live" || mode === "production" || process.env.NODE_ENV === "production";
  if (withSeed && prodLike && process.env.ALLOW_SEED !== "1") {
    console.error(
      `[migrate] REFUSED: --seed in ${mode ?? process.env.NODE_ENV} mode. The seed is dev/test ` +
        `demo data (fixed public UUIDs). Set ALLOW_SEED=1 only if you really mean it.`,
    );
    process.exit(1);
  }

  const { migrations, seeds } = loadMigrationFiles(MIGRATIONS_DIR);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  // pg's Client.query covers both SqlClient methods (no-params query = simple protocol,
  // which accepts multi-statement scripts).
  const sql: SqlClient = {
    query: (text, params) => client.query(text, params as unknown[]),
    exec: (text) => client.query(text),
  };
  try {
    await applyMigrations(sql, migrations);
    if (withSeed) await applySeeds(sql, seeds);
  } finally {
    await client.end();
  }
  console.log("[migrate] done.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
