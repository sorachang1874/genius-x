/**
 * @genius-x/server bootstrap (composition root). Selects the store by runtime mode, then
 * delegates to startClassroomServer. No business logic here.
 */
import { Redis } from "ioredis";
import { loadConfig } from "@genius-x/config";
import { InMemorySessionStore, RedisSessionStore, type SessionStore } from "./session/store";
import { RedisTurnBufferStore } from "./session/turnbuffer";
import { createIdentityPool } from "./identity/db";
import { IdentityService } from "./identity/service";
import { WorkspaceService } from "./workspace/service";
import { ShareService } from "./share/service";
import { startClassroomServer } from "./server";

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const liveLike = config.mode === "live" || config.mode === "production";
  // ONE Redis connection serves both classroom-tier stores (sessions + Phase-4 turn
  // buffers) — same lifecycle, same availability class (agent-context.md hot path).
  const redis = liveLike ? new Redis(config.redisUrl!) : undefined;
  const store: SessionStore = redis ? new RedisSessionStore(redis) : new InMemorySessionStore();
  const turnBuffer = redis ? new RedisTurnBufferStore(redis) : undefined; // dev default = server.ts in-memory

  // Identity (Phase 1): CORE dependency for enrollment/admin API (and Step-5 student joins).
  // Absence is a visible deployment state, never a silent fallback. loadConfig already
  // REQUIRES databaseUrl in live/production, so this branch only disables in local/scripted.
  // NOTE: identity endpoints are UNAUTHENTICATED until Phase 3 (Better Auth) — they must not
  // be internet-exposed in Phase 1 (operator-bounded deployment; pin CORS_ORIGIN).
  const pool = config.databaseUrl ? createIdentityPool(config.databaseUrl) : undefined;
  const identity = pool ? new IdentityService(pool) : undefined;
  const workspace = pool ? new WorkspaceService(pool) : undefined; // same pool, same lifecycle
  const share = pool ? new ShareService(pool) : undefined;
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

  // Phase 3 retention sweep (parent-share.md: share tokens purge at expiry+30d). Boot-time
  // is the scheduled-job stand-in; the count is logged so deletions are operator-visible.
  if (share) {
    try {
      const purged = await share.purgeExpired();
      if (purged > 0) console.log(`[share] retention sweep: purged ${purged} share token(s) past expiry+30d`);
    } catch (err) {
      console.error("[share] retention sweep FAILED (continuing; tokens purge on next boot):", (err as Error).name);
    }
  }

  // Step 5: sessions bind to an EXPLICIT tenant in live/production — DEFAULT_DEMO_TENANT_ID
  // is dev/demo-only, never a silent production fallback (fail closed; PHANDBOOK Step 5.6).
  // The VALUE is validated too: a typo'd tenant would boot green and then 403 every child
  // at class start — same deploy-time-failure principle as the DB preflight above.
  const tenantId = process.env.TENANT_ID?.trim() || undefined;
  if (liveLike && !tenantId) {
    throw new Error(
      "TENANT_ID is required in live/production mode — sessions must bind to an explicit " +
        "tenant (the demo tenant default is dev-only).",
    );
  }
  if (tenantId) {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(tenantId)) {
      throw new Error(`TENANT_ID is not a UUID: "${tenantId}"`);
    }
    if (pool) {
      try {
        const found = await pool.query("SELECT 1 FROM tenants WHERE id = $1", [tenantId]);
        if (found.rows.length === 0) throw new Error(`TENANT_ID ${tenantId} does not exist in the tenants table`);
      } catch (err) {
        if (liveLike) throw err instanceof Error ? err : new Error(String(err));
        console.error("[bootstrap] TENANT_ID preflight FAILED (continuing in dev mode):", (err as Error).message);
      }
    }
  }

  const handle = await startClassroomServer({
    port: Number(process.env.PORT ?? 3000),
    host: process.env.HOST ?? "0.0.0.0",
    store,
    ...(identity && { identity }),
    ...(workspace && { workspace }),
    ...(share && { share }),
    ...(process.env.WEB_BASE_URL && { webBaseUrl: process.env.WEB_BASE_URL }),
    ...(tenantId && { tenantId }),
    ...(process.env.CORS_ORIGIN && { corsOrigin: process.env.CORS_ORIGIN }),
    ...(turnBuffer && { turnBuffer }),
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
