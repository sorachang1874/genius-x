/**
 * @genius-x/server bootstrap (composition root). Selects the store by runtime mode, then
 * delegates to startClassroomServer. No business logic here.
 */
import { Redis } from "ioredis";
import { loadConfig } from "@genius-x/config";
import { InMemorySessionStore, RedisSessionStore, type SessionStore } from "./session/store";
import { createIdentityPool } from "./identity/db";
import { IdentityService } from "./identity/service";
import { startClassroomServer } from "./server";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const liveLike = config.mode === "live" || config.mode === "production";
  const store: SessionStore = liveLike
    ? new RedisSessionStore(new Redis(config.redisUrl!))
    : new InMemorySessionStore();

  // Identity (Phase 1): CORE dependency for enrollment/admin API (and Step-5 student joins).
  // Absence is a visible deployment state, never a silent fallback. loadConfig already
  // REQUIRES databaseUrl in live/production, so this branch only disables in local/scripted.
  // NOTE: identity endpoints are UNAUTHENTICATED until Phase 3 (Better Auth) — they must not
  // be internet-exposed in Phase 1 (operator-bounded deployment; pin CORS_ORIGIN).
  const pool = config.databaseUrl ? createIdentityPool(config.databaseUrl) : undefined;
  const identity = pool ? new IdentityService(pool) : undefined;
  if (!identity) {
    console.warn(
      "[bootstrap] identity routes DISABLED — no DATABASE_URL configured " +
        "(enrollment/admin API unavailable; Step-5 student joins will require it)",
    );
  }

  if (pool) {
    // Boot preflight: pg.Pool is LAZY (no connection at construction), so a typo'd or
    // unreachable DATABASE_URL would otherwise boot green ("identity=on") and only fail at
    // the first enrollment / class join. Identity is a CORE dependency — fail loudly at
    // DEPLOY time: fatal in live/production, loud-but-continue in dev modes.
    try {
      await pool.query("SELECT 1");
    } catch (err) {
      if (liveLike) throw new Error(`identity DB preflight failed: ${(err as Error).name}`);
      console.error("[bootstrap] identity DB preflight FAILED (continuing in dev mode):", (err as Error).name);
    }
  }

  const handle = await startClassroomServer({
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "0.0.0.0",
    store,
    ...(identity && { identity }),
    ...(process.env.CORS_ORIGIN && { corsOrigin: process.env.CORS_ORIGIN }),
  });
  console.log(`genius-x server (mode=${config.mode}, identity=${identity ? "on" : "OFF"}) listening on ${handle.url}`);

  // Graceful shutdown: close the HTTP/WS server, then drain the identity pool — otherwise
  // open idle sockets hold the process (and in-flight queries die unlogged).
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => {
      void handle
        .close()
        .then(() => pool?.end())
        .finally(() => process.exit(0));
    });
  }
}

void main();
