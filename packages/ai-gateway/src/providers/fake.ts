/**
 * Scripted fake provider — SKELETON (M2 fills the runtime: latency timers, fault injection,
 * async job store, optional fake HTTP server + webhook). For now it returns minimal valid
 * results so the boundary type-checks and downstream code can be built against it.
 *
 * Runs in GENIUS_X_MODE=scripted: deterministic, zero API cost, key-free — the basis for
 * unattended/overnight development and the Lesson-1 smoke.
 */
import type {
  LlmTextResult,
  TtsResult,
  AsrResult,
  ImageGenResult,
} from "@genius-x/contracts";
import type {
  ProviderAdapter,
  LlmRequest,
  TtsRequest,
  AsrRequest,
  ImageGenRequest,
  ImageJob,
  ImagePollResult,
  FakeProviderConfig,
} from "./types.js";

export class FakeProvider implements ProviderAdapter {
  constructor(private readonly config: FakeProviderConfig = {}) {}

  // TODO(M2): apply this.config fault injection (latencyMs/fail/timeout/filteredOutput)
  // and SLO timing; wire async job store + optional webhook. Skeleton returns happy-path.

  async llm(req: LlmRequest): Promise<LlmTextResult> {
    return {
      capability: "llm",
      text: `(fake llm reply for ${req.promptVersion})`,
      meta: { source: "primary", degraded: false },
    };
  }

  async tts(_req: TtsRequest): Promise<TtsResult> {
    return {
      capability: "tts",
      audioUrl: "fake://tts/clip.mp3",
      meta: { source: "primary", degraded: false },
    };
  }

  async asr(_req: AsrRequest): Promise<AsrResult> {
    return {
      capability: "asr",
      transcript: "(fake transcript)",
      meta: { source: "primary", degraded: false },
    };
  }

  async imageSubmit(_req: ImageGenRequest): Promise<ImageJob> {
    return { jobId: "fake-job-0001" };
  }

  async imagePoll(_job: ImageJob): Promise<ImagePollResult> {
    const result: ImageGenResult = {
      capability: "image_gen",
      imageUrls: ["fake://img/0.png", "fake://img/1.png", "fake://img/2.png"],
      meta: { source: "primary", degraded: false },
    };
    return result;
  }
}
