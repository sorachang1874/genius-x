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
} from "@genius-x/contracts";

export interface LlmRequest {
  promptVersion: string; // e.g. "icebreak_v1"
  input: string;
  maxOutputTokens?: number;
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
