/**
 * TurnBufferStore — the HOT in-scene context tier (docs/contracts/agent-context.md).
 *
 * A keyed store BESIDE the SessionStore — deliberately NOT a `ClassSession` field (raw
 * child utterances must never ride RESUME_STATE or any client-bound message) and NOT a
 * workspace table (classroom workspace writes are fire-and-forget ⇒ racy for synchronous
 * reads). Scene key (Phase 4): scene == stage ⇒ `(sessionId, studentId, stageId)`.
 *
 * Availability class: classroom-tier (lives where the session lives). Failures NEVER
 * propagate into the interaction path — the caller degrades to a stateless call with a
 * `context_degraded` trace (the contract's failure mode).
 *
 * Bounds are the contract constants (TURN_BUFFER_MAX_ROUNDS / _MAX_BYTES), enforced on
 * append, oldest-evicted. Buffer content is ephemeral runtime data — the workspace
 * InteractionRecord remains the persistent transcript; losing a buffer loses no
 * contractual data.
 */
import type { Redis } from "ioredis";
import type { TurnBufferEntry } from "@genius-x/contracts";
import { boundTurnBuffer } from "@genius-x/contracts";

export interface TurnBufferKey {
  sessionId: string;
  studentId: string;
  stageId: string;
}

export interface TurnBufferStore {
  append(key: TurnBufferKey, entry: TurnBufferEntry): Promise<void>;
  read(key: TurnBufferKey): Promise<TurnBufferEntry[]>;
  /** Read-and-clear (end-of-scene consolidation drains the buffer exactly once). */
  drain(key: TurnBufferKey): Promise<TurnBufferEntry[]>;
  /** Lesson-end sweep (owner-matrix deletion clause): drop every buffer of a session. */
  clearSession(sessionId: string): Promise<void>;
}

// Bounding is the SHARED pure boundTurnBuffer (@genius-x/contracts): per-entry clamp →
// ROUNDS window (pairs, not entries) → byte eviction → child-aligned head. One algorithm
// for the store AND the gateway's defensive bound, so the two can never drift. Store-side
// eviction is the by-design rolling window (no trace); single-entry CLAMPS are anomalies,
// traced by the WRITER (controller bufferRound) before append.

/** Collision-proof key (a delimiter inside an id must never merge two children's buffers). */
const keyOf = (k: TurnBufferKey): string => JSON.stringify([k.sessionId, k.studentId, k.stageId]);

export class InMemoryTurnBufferStore implements TurnBufferStore {
  private readonly buffers = new Map<string, TurnBufferEntry[]>();

  async append(key: TurnBufferKey, entry: TurnBufferEntry): Promise<void> {
    const k = keyOf(key);
    this.buffers.set(k, boundTurnBuffer([...(this.buffers.get(k) ?? []), entry]).entries);
  }

  async read(key: TurnBufferKey): Promise<TurnBufferEntry[]> {
    return this.buffers.get(keyOf(key)) ?? [];
  }

  async drain(key: TurnBufferKey): Promise<TurnBufferEntry[]> {
    const k = keyOf(key);
    const out = this.buffers.get(k) ?? [];
    this.buffers.delete(k);
    return out;
  }

  async clearSession(sessionId: string): Promise<void> {
    const prefix = JSON.stringify([sessionId]).slice(0, -1) + ","; // '["<sessionId>",'
    for (const k of [...this.buffers.keys()]) {
      if (k.startsWith(prefix)) this.buffers.delete(k);
    }
  }
}

/**
 * Redis impl — one JSON value per buffer key with a TTL safety net (a crashed class's
 * buffers expire on their own; consolidation normally drains them first). Best-effort
 * read-modify-write: a student's interactions are near-serial, and the buffer is
 * advisory context — a lost turn under a rare race degrades coherence, never correctness
 * (the workspace transcript is the record).
 */
export class RedisTurnBufferStore implements TurnBufferStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix = "gx:turnbuf:",
    /** Safety-net TTL (seconds); refreshed on every append. Default 24h. */
    private readonly ttlSeconds = 24 * 60 * 60,
  ) {}

  /** Components are URI-escaped — a ":" inside an id can never merge two buffers. */
  private k(key: TurnBufferKey): string {
    return `${this.prefix}${encodeURIComponent(key.sessionId)}:${encodeURIComponent(key.studentId)}:${encodeURIComponent(key.stageId)}`;
  }

  async append(key: TurnBufferKey, entry: TurnBufferEntry): Promise<void> {
    const k = this.k(key);
    const json = await this.redis.get(k);
    const entries = json ? (JSON.parse(json) as TurnBufferEntry[]) : [];
    await this.redis.set(k, JSON.stringify(boundTurnBuffer([...entries, entry]).entries), "EX", this.ttlSeconds);
  }

  async read(key: TurnBufferKey): Promise<TurnBufferEntry[]> {
    const json = await this.redis.get(this.k(key));
    return json ? (JSON.parse(json) as TurnBufferEntry[]) : [];
  }

  /** NOTE: GETDEL requires Redis server >= 6.2 (compose pins redis:7 — documented in agent-context.md). */
  async drain(key: TurnBufferKey): Promise<TurnBufferEntry[]> {
    const k = this.k(key);
    const json = await this.redis.getdel(k);
    return json ? (JSON.parse(json) as TurnBufferEntry[]) : [];
  }

  /** TTL is the primary Redis cleanup; the sweep deletes a known session's keys eagerly. */
  async clearSession(sessionId: string): Promise<void> {
    const pattern = `${this.prefix}${encodeURIComponent(sessionId)}:*`;
    const keys = await this.redis.keys(pattern); // bounded: ≤ students × stages per session
    if (keys.length > 0) await this.redis.del(...keys);
  }
}
