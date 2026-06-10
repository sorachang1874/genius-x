/**
 * Agent context — typed realization of docs/contracts/agent-context.md (Phase 4).
 *
 * Two context paths, never merged:
 *   HOT  — in-scene turn buffer (session-store tier, bounded, NEVER in ClassSession or any
 *          client-bound message — RESUME_STATE carries no transcripts)
 *   COLD — cross-lesson retrieval from the workspace (canon + semantic latest-per-key +
 *          episodic), shadow-grade (workspace down ⇒ lesson unaffected, traced)
 *
 * AI-first principle (P1): the EPISODIC memory kind is validated by SCHEMA, not vocabulary —
 * the closed declaredMemoryKeys set remains only for semantic slots.
 */

/**
 * One buffered conversation TURN (hot path). Newest last. A ROUND is a child+companion
 * PAIR of entries — the contract bound TURN_BUFFER_MAX_ROUNDS counts rounds, not entries.
 */
export interface TurnBufferEntry {
  role: "child" | "companion";
  text: string;
}

/** Turn-buffer bounds (operator-configurable per deployment, never per child). */
export const TURN_BUFFER_MAX_ROUNDS = 8; // rounds = child+companion pairs ⇒ up to 16 entries
export const TURN_BUFFER_MAX_BYTES = 16_384; // whole-buffer serialized cap
export const TURN_ENTRY_MAX_BYTES = 4_096; // single-entry text cap (a 16KB+ turn must not ride every prompt)

/** Portable UTF-8 byte length (no TextEncoder/Buffer — this package has no runtime libs). */
function utf8Bytes(s: string): number {
  let bytes = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
  }
  return bytes;
}

/** Byte-safe single-entry clamp. Callers trace when `clamped` (never a silent cut). */
export function clampTurnText(text: string): { text: string; clamped: boolean } {
  if (utf8Bytes(text) <= TURN_ENTRY_MAX_BYTES) return { text, clamped: false };
  let t = text;
  while (t.length > 0 && utf8Bytes(t) > TURN_ENTRY_MAX_BYTES) {
    t = t.slice(0, Math.max(1, Math.floor(t.length * 0.9)));
    if (t.length === 1 && utf8Bytes(t) > TURN_ENTRY_MAX_BYTES) return { text: "", clamped: true };
  }
  return { text: t, clamped: true };
}

/**
 * THE one turn-buffer bounding algorithm (shared by the server store and the gateway so
 * the two can never drift): per-entry clamp → keep the newest TURN_BUFFER_MAX_ROUNDS
 * ROUNDS (= ×2 entries) → whole-buffer byte eviction (oldest first) → re-align the head
 * to a child turn (history never starts with an orphan companion reply). The returned
 * buffer is ALWAYS within budget. Pure + portable (no TextEncoder/Buffer).
 */
export function boundTurnBuffer(entries: TurnBufferEntry[]): {
  entries: TurnBufferEntry[];
  /** Entries whose text was clamped to TURN_ENTRY_MAX_BYTES (callers trace > 0). */
  clampedEntries: number;
  /** Total entries evicted (rolling window + byte cap + head realignment) — telemetry. */
  droppedEntries: number;
} {
  let clampedEntries = 0;
  let out = entries.map((e) => {
    const c = clampTurnText(e.text);
    if (c.clamped) clampedEntries++;
    return c.clamped ? { ...e, text: c.text } : e;
  });
  const before = out.length;
  out = out.slice(-(TURN_BUFFER_MAX_ROUNDS * 2));
  while (out.length > 0 && utf8Bytes(JSON.stringify(out)) > TURN_BUFFER_MAX_BYTES) {
    out = out.slice(1);
  }
  while (out.length > 0 && out[0]!.role === "companion") {
    out = out.slice(1);
  }
  return { entries: out, clampedEntries, droppedEntries: before - out.length };
}

/**
 * RESERVED memory kind for episodic memories. Never in a lesson's declaredMemoryKeys
 * (the validator fails closed on a lesson declaring it); the memory-key checks carve out
 * exactly this value for schema-validated episode writes.
 */
export const EPISODE_MEMORY_KEY = "episode";

/** Episode payload — `StudentMemory.value` is the JSON of this shape when key === "episode". */
export interface EpisodeValue {
  /** Bounded scene summary (≤ EPISODE_SUMMARY_MAX_CHARS) — curated, never verbatim speech. */
  summary: string;
  /** ≤ EPISODE_MAX_TAGS tags, each ≤ EPISODE_TAG_MAX_CHARS chars. */
  tags: string[];
}

export const EPISODE_SUMMARY_MAX_CHARS = 500;
export const EPISODE_MAX_TAGS = 5;
export const EPISODE_TAG_MAX_CHARS = 20;

/** Safety status of a recorded exchange (additive workspace column, Phase 4 migration). */
export type InteractionSafetyStatus = "ok" | "input_filtered" | "output_filtered";

// --- COLD path (cross-lesson retrieval — agent-context.md) ---

/** The versioned context prompt contract (model-input contract, ONE assembly point). */
export const CONTEXT_VERSION = "context_v1";
/** Semantic memories: latest-per-key dedup (DF-v2-15), importance-ranked, top K. */
export const CONTEXT_SEMANTIC_TOP_K = 12;
/** Episodic memories: recency+importance ranked, top K. */
export const CONTEXT_EPISODE_TOP_K = 3;

/**
 * Parse + schema-validate an episode JSON (the ONE validator both boundaries use —
 * gateway output parsing AND the workspace write path — so they can never drift).
 * Returns null on ANY violation: not-JSON, wrong shape, oversize summary/tags. Callers
 * trace the rejection (never a silent truncation — the contract forbids it).
 */
export function parseEpisodeValue(json: string): EpisodeValue | null {
  let o: unknown;
  try {
    o = JSON.parse(json);
  } catch {
    return null;
  }
  if (o === null || typeof o !== "object" || Array.isArray(o)) return null;
  // CLOSED schema (fail closed — silently accepting unknown keys is the forbidden
  // fallback): exactly {summary, tags}, nothing smuggled alongside.
  const keys = Object.keys(o as Record<string, unknown>);
  if (keys.length !== 2 || !keys.includes("summary") || !keys.includes("tags")) return null;
  const e = o as { summary?: unknown; tags?: unknown };
  if (typeof e.summary !== "string" || e.summary === "" || e.summary.length > EPISODE_SUMMARY_MAX_CHARS) return null;
  if (!Array.isArray(e.tags) || e.tags.length > EPISODE_MAX_TAGS) return null;
  if (!e.tags.every((t) => typeof t === "string" && t !== "" && t.length <= EPISODE_TAG_MAX_CHARS)) return null;
  return { summary: e.summary, tags: e.tags as string[] };
}
