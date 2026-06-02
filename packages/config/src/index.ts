/**
 * @genius-x/config — central runtime configuration.
 *
 * The runtime mode is selected explicitly and validated; it is NOT inferred from scattered
 * env vars (playbook: runtime-and-environment-isolation). Secrets are read from the
 * environment, never committed. Shadow integrations (Langfuse, etc.) are always optional —
 * their absence must not break the classroom (see AGENTS.md).
 */
import type { RuntimeMode } from "@genius-x/contracts";

const MODES: readonly RuntimeMode[] = ["local", "scripted", "live", "production"];

/** A minimal env shape so this stays dependency-free (caller passes process.env). */
export type Env = Record<string, string | undefined>;

export interface AppConfig {
  mode: RuntimeMode;
  /** Primary datastores (PRD §3). Required in live/production, may be absent otherwise. */
  databaseUrl?: string | undefined;
  redisUrl?: string | undefined;
  /** Shadow observability — always optional; off by default. */
  langfuseEnabled: boolean;
}

export class ConfigError extends Error {}

function parseMode(raw: string | undefined): RuntimeMode {
  const mode = (raw ?? "local") as RuntimeMode;
  if (!MODES.includes(mode)) {
    throw new ConfigError(
      `Invalid GENIUS_X_MODE "${raw}". Expected one of: ${MODES.join(", ")}`,
    );
  }
  return mode;
}

function need(env: Env, key: string, mode: RuntimeMode): string {
  const v = env[key];
  if (v === undefined || v === "") {
    throw new ConfigError(`Missing required config "${key}" for mode "${mode}".`);
  }
  return v;
}

/**
 * Load + validate config. Fails closed with a clear message rather than silently
 * defaulting into a wrong mode.
 */
export function loadConfig(env: Env): AppConfig {
  const mode = parseMode(env.GENIUS_X_MODE);
  const liveLike = mode === "live" || mode === "production";

  return {
    mode,
    // local/scripted may run without real datastores; live/production must have them.
    databaseUrl: liveLike ? need(env, "DATABASE_URL", mode) : env.DATABASE_URL,
    redisUrl: liveLike ? need(env, "REDIS_URL", mode) : env.REDIS_URL,
    langfuseEnabled: env.LANGFUSE_ENABLED === "true",
  };
}
