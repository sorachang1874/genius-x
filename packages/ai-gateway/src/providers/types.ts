/**
 * Provider adapter — the boundary the AI gateway routes through. SKELETON (M2).
 *
 * This is the gateway's INTERNAL boundary: callers use the gateway's public capability
 * methods; the gateway routes among adapters that implement this interface. Real Tencent
 * adapters and the scripted fakes BOTH implement `ProviderAdapter`, so swapping providers
 * (D3) never touches business code, and the simulation harness can stand in for live calls.
 *
 * Async image flow models real providers: submit → job → poll/callback → result.
 * Returns reuse the frozen contract types (`@genius-x/contracts`).
 */
import type {
  LlmTextResult,
  TtsResult,
  AsrResult,
  ImageGenResult,
  TurnBufferEntry,
} from "@genius-x/contracts";

export interface LlmRequest {
  promptVersion: string; // e.g. "icebreak_v1"
  input: string;
  maxOutputTokens?: number;
  /**
   * Bounded in-scene conversation history, newest last (agent-context.md hot path).
   * OPTIONAL + backward compatible: absent/empty ⇒ exactly the stateless behavior.
   * Entries were already input-reviewed when buffered; the gateway re-reviews only
   * the current `input`. Adapters that cannot carry history degrade to stateless
   * WITH a trace (`history_unsupported`) — never silently.
   */
  history?: TurnBufferEntry[];
  /**
   * COLD context block (agent-context.md cold path): the versioned `context_v1`
   * assembly (canon + semantic memories + episodes). The gateway input-reviews it
   * defensively (filtered ⇒ DROPPED with a trace, the call proceeds without it) and
   * stamps `contextVersion` in traces. Adapters decide placement (system prompt vs
   * prefix); the fakes ignore it.
   */
  context?: { version: string; text: string };
}

export interface TtsRequest {
  text: string;
  voice?: string;
}

export interface AsrRequest {
  /** Reference to audio, never raw audio bytes (data-and-privacy: no raw audio persisted). */
  audioRef: string;
}

export interface ImageGenRequest {
  kind: "img2img" | "text2img";
  /** Doodle image ref (img2img) or assembled prompt (text2img). */
  source: string;
  count: number;
}

/** Async image generation handle. */
export interface ImageJob {
  jobId: string;
}

export type ImagePollResult = ImageGenResult | { status: "pending" };

export interface ProviderAdapter {
  /**
   * History capability (agent-context.md): "unsupported" ⇒ the gateway STRIPS history and
   * traces `history_unsupported` (degrade-to-stateless is loud, never silent). Absent =
   * "native" (the adapter consumes/forwards req.history).
   */
  readonly llmHistory?: "native" | "unsupported";
  llm(req: LlmRequest): Promise<LlmTextResult>;
  tts(req: TtsRequest): Promise<TtsResult>;
  asr(req: AsrRequest): Promise<AsrResult>;
  imageSubmit(req: ImageGenRequest): Promise<ImageJob>;
  imagePoll(job: ImageJob): Promise<ImagePollResult>;
}

/**
 * Fault injection for the scripted simulation harness — lets tests exercise the FULL chain
 * and assert SLOs/acceptance (see providers/README.md), not just happy-path returns.
 */
export interface FakeBehavior {
  latencyMs?: number; // simulate provider latency (assert against SLO budgets)
  fail?: boolean; // simulate a provider error → gateway should route/fallback
  timeout?: boolean; // simulate exceeding the latency budget → fallback
  filteredOutput?: boolean; // simulate unsafe output → safety pipeline must catch + fallback
}

export interface FakeProviderConfig {
  llm?: FakeBehavior;
  tts?: FakeBehavior;
  asr?: FakeBehavior;
  image?: FakeBehavior;
}
