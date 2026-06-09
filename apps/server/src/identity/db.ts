/**
 * PostgreSQL connection pool for the Identity Service (Phase 1).
 *
 * One pool per process (composition root creates it, services receive it) — never a
 * client-per-query. Identity is a CORE dependency consulted at enrollment/join time
 * only (enrollment.md → Failure modes): a DB outage fails new joins loudly and is
 * operator-visible; it never touches a running classroom (runtime state is in Redis).
 *
 * DATABASE_URL comes from @genius-x/config (required in live/production modes).
 * Local default (docker-compose.yml): postgres://geniusx:geniusx@localhost:5432/geniusx
 */
import pg from "pg";

export interface IdentityDbOptions {
  /** Max pooled connections. Identity load is light (lookups at join + admin tools). */
  max?: number;
  /** Close idle clients after this long. */
  idleTimeoutMillis?: number;
  /** Fail fast when the DB is unreachable — loud failure, not a hanging join. */
  connectionTimeoutMillis?: number;
}

export function createIdentityPool(databaseUrl: string, opts: IdentityDbOptions = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: opts.max ?? 10,
    idleTimeoutMillis: opts.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: opts.connectionTimeoutMillis ?? 5_000,
  });
  // node-postgres emits 'error' on the pool when an IDLE client's backend dies (Postgres
  // restart, network blip). Without a listener that is an unhandled 'error' event — it would
  // CRASH the process hosting the classroom WS, violating "a DB outage never touches a
  // running classroom". Log operator-visibly and let in-flight queries fail loudly instead.
  pool.on("error", (err) => {
    console.error("[identity-db] idle client error (operator-visible; classroom unaffected):", err.message);
  });
  return pool;
}
