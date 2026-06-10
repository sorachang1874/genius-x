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

/** One buffered conversation round (hot path). Newest last. */
export interface TurnBufferEntry {
  role: "child" | "companion";
  text: string;
}

/** Turn-buffer bounds (operator-configurable per deployment, never per child). */
export const TURN_BUFFER_MAX_ROUNDS = 8;
export const TURN_BUFFER_MAX_BYTES = 16_384;

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
