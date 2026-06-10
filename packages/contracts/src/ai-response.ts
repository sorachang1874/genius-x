/**
 * AI gateway response + safety + trace contracts — v0 (frozen v0).
 * Every AI result is validated at the gateway boundary before reaching a client.
 * Source: PRD §5. Reuse: Vercel AI SDK + Zod (Zod schemas back these types — added in
 * the gateway implementation, not here).
 */
import type { MemoryKey } from "./enums";

/** Where a result came from — enforces operator-visible degradation (AGENTS.md). */
export type AiSource = "primary" | "fallback" | "library";

/** Envelope carried by every gateway result so degradation is never silent. */
export interface AiMeta {
  source: AiSource;
  degraded: boolean; // true if not the primary provider's clean output
  promptVersion?: string; // e.g. "icebreak_v1"
  latencyMs?: number;
}

export interface LlmTextResult {
  capability: "llm";
  text: string;
  meta: AiMeta;
}

export interface TtsResult {
  capability: "tts";
  audioUrl: string;
  meta: AiMeta;
}

export interface AsrResult {
  capability: "asr";
  transcript: string;
  meta: AiMeta;
}

export interface ImageGenResult {
  capability: "image_gen";
  imageUrls: string[]; // candidate images (moderated before display)
  meta: AiMeta;
}

export type AiResult = LlmTextResult | TtsResult | AsrResult | ImageGenResult;

/** Background memory extraction output (PRD §7.4, appendix B2). */
export interface MemoryExtraction {
  key: MemoryKey | null;
  value: string | null;
}

/** Output of the safety pipeline (input or output review). Source: PRD §5.3, docs/contracts/safety.md. */
export interface SafetyResult {
  ok: boolean;
  action: "pass" | "filtered" | "fallback";
  reasons: string[]; // e.g. ["sensitive_word", "length", "tianyu_block"]
}

/**
 * TraceSink — shadow observability seam (Langfuse). MUST be fire-and-forget: async,
 * timeout-bounded, errors swallowed. Default sink is no-op/console. Langfuse down ⇒
 * classroom unaffected (AGENTS.md: shadow systems must not break the classroom).
 */
export interface TraceEvent {
  at: string; // ISO timestamp (passed in; not generated in pure contract code)
  kind:
    | "ai_request"
    | "ai_response"
    | "safety"
    | "fallback"
    | "interaction"
    | "stage_transition"
    | "force_advance" // operator-visible audit of an assistant override
    | "join_rejected"; // Phase 1: every refused student join, counted (enrollment.md: "operator sees the real 400/404/403 + count")
  studentId?: string;
  stageId?: string;
  promptVersion?: string;
  payload: Record<string, unknown>; // redacted before it reaches here
}

export interface TraceSink {
  record(event: TraceEvent): void; // never throws, never blocks the caller
}
