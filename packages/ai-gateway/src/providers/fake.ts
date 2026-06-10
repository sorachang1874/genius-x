/**
 * Scripted fake provider for GENIUS_X_MODE=scripted — deterministic, zero key/cost. Honors
 * FakeProviderConfig fault injection (latency / fail / timeout / filteredOutput) so tests +
 * the smoke can exercise the full chain (SLO, fallback, safety) without real providers.
 */
import type { LlmTextResult, TtsResult, AsrResult, ImageGenResult } from "@genius-x/contracts";
import type {
  ProviderAdapter,
  LlmRequest,
  TtsRequest,
  AsrRequest,
  ImageGenRequest,
  ImageJob,
  ImagePollResult,
  FakeBehavior,
  FakeProviderConfig,
} from "./types";

/** Canned outputs (override per test, e.g. a memory JSON for extractMemory). */
export interface FakeContent {
  llmText?: string;
  transcript?: string;
  audioUrl?: string;
  imageUrls?: string[];
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });
}

export class FakeProvider implements ProviderAdapter {
  constructor(
    private readonly config: FakeProviderConfig = {},
    private readonly content: FakeContent = {},
  ) {}

  /** Apply injected faults before producing output. */
  private async gate(b: FakeBehavior | undefined): Promise<void> {
    if (b?.latencyMs) await delay(b.latencyMs);
    if (b?.timeout) await delay(3_600_000); // never settles within any budget → gateway times out
    if (b?.fail) throw new Error("fake provider failure");
  }

  async llm(req: LlmRequest): Promise<LlmTextResult> {
    await this.gate(this.config.llm);
    const text = this.config.llm?.filteredOutput
      ? "这里有暴力内容" // trips the output safety filter
      : (this.content.llmText ??
        // Scripted episode shape so demo/e2e consolidation produces a VALID episode
        // (a generic fake reply would schema-miss and trace on every scene exit).
        (req.promptVersion === "episode_v1"
          ? '{"summary":"(fake) 这一幕里我们聊得很开心","tags":["fake"]}'
          : `(fake reply: ${req.promptVersion})`));
    return { capability: "llm", text, meta: { source: "primary", degraded: false } };
  }

  async tts(_req: TtsRequest): Promise<TtsResult> {
    await this.gate(this.config.tts);
    return { capability: "tts", audioUrl: this.content.audioUrl ?? "fake://tts/clip.mp3", meta: { source: "primary", degraded: false } };
  }

  async asr(_req: AsrRequest): Promise<AsrResult> {
    await this.gate(this.config.asr);
    return { capability: "asr", transcript: this.content.transcript ?? "(fake transcript)", meta: { source: "primary", degraded: false } };
  }

  async imageSubmit(_req: ImageGenRequest): Promise<ImageJob> {
    await this.gate(this.config.image);
    return { jobId: "fake-job-0001" };
  }

  async imagePoll(_job: ImageJob): Promise<ImagePollResult> {
    const imageUrls = this.content.imageUrls ?? ["fake://img/0.png", "fake://img/1.png", "fake://img/2.png"];
    return { capability: "image_gen", imageUrls, meta: { source: "primary", degraded: false } };
  }
}
