/**
 * AiGateway — the single entry point for AI. Each capability runs:
 *   input safety → provider call (timeout-bounded) → output safety → fallback on any
 *   fail/timeout/filtered (meta.degraded=true) → audit (TraceSink).
 * It NEVER throws to the caller; the classroom always gets a result. AiMeta stays here +
 * in traces (not shipped to the child — see D-M2 design / data-and-privacy).
 */
import type {
  LlmTextResult,
  TtsResult,
  AsrResult,
  ImageGenResult,
  MemoryExtraction,
  TraceEvent,
  TraceSink,
} from "@genius-x/contracts";
import type {
  ProviderAdapter,
  LlmRequest,
  TtsRequest,
  AsrRequest,
  ImageGenRequest,
} from "./providers/types";
import type { SafetyFilter } from "./safety";
import type { FallbackLibrary } from "./fallback";

export interface ExtractMemoryRequest {
  transcript: string;
  allowedKeys: string[];
  promptVersion: string;
  studentId?: string;
  stageId?: string;
}

export interface GatewayDeps {
  provider: ProviderAdapter;
  safety: SafetyFilter;
  fallback: FallbackLibrary;
  trace: TraceSink;
  now: () => string;
  /** Per-capability latency budgets (PRD §10.1). Defaults applied if omitted. */
  timeouts?: { llm?: number; tts?: number; asr?: number; image?: number };
}

const DEFAULT_TIMEOUTS = { llm: 8000, tts: 2000, asr: 8000, image: 15000 };

export class AiGateway {
  constructor(private readonly d: GatewayDeps) {}

  async llm(req: LlmRequest): Promise<LlmTextResult> {
    const input = this.d.safety.reviewInput(req.input);
    if (!input.ok) return this.llmFallback(req.promptVersion, "input_filtered", input.reasons);
    try {
      const r = await withTimeout(this.d.provider.llm(req), this.timeout("llm"));
      const out = this.d.safety.reviewOutput(r.text);
      if (!out.ok) return this.llmFallback(req.promptVersion, "output_filtered", out.reasons);
      this.emit("ai_response", { capability: "llm", promptVersion: req.promptVersion });
      return r;
    } catch (e) {
      return this.llmFallback(req.promptVersion, reason(e), []);
    }
  }

  async tts(req: TtsRequest): Promise<TtsResult> {
    try {
      return await withTimeout(this.d.provider.tts(req), this.timeout("tts"));
    } catch (e) {
      this.emit("fallback", { capability: "tts", reason: reason(e) });
      return this.d.fallback.tts();
    }
  }

  async asr(req: AsrRequest): Promise<AsrResult> {
    try {
      return await withTimeout(this.d.provider.asr(req), this.timeout("asr"));
    } catch (e) {
      this.emit("fallback", { capability: "asr", reason: reason(e) });
      return this.d.fallback.asr();
    }
  }

  async imageGen(req: ImageGenRequest): Promise<ImageGenResult> {
    try {
      const job = await withTimeout(this.d.provider.imageSubmit(req), this.timeout("image"));
      const result = await withTimeout(this.pollUntilDone(job), this.timeout("image"));
      // NOTE: image content moderation (天御 IMS, before display) lands in M6.
      this.emit("ai_response", { capability: "image_gen" });
      return result;
    } catch (e) {
      this.emit("fallback", { capability: "image_gen", reason: reason(e) });
      return this.d.fallback.imageGen(req.count);
    }
  }

  /** Extract a memory point; the returned key MUST be one the lesson declared, else null. */
  async extractMemory(req: ExtractMemoryRequest): Promise<MemoryExtraction> {
    try {
      const r = await withTimeout(
        this.d.provider.llm({ promptVersion: req.promptVersion, input: req.transcript }),
        this.timeout("llm"),
      );
      const parsed = parseMemory(r.text);
      if (parsed.key !== null && !req.allowedKeys.includes(parsed.key)) {
        this.emit("interaction", { reason: "memory_key_not_allowed", key: parsed.key });
        return { key: null, value: null };
      }
      return parsed;
    } catch (e) {
      this.emit("fallback", { capability: "extract_memory", reason: reason(e) });
      return { key: null, value: null };
    }
  }

  private async pollUntilDone(job: { jobId: string }): Promise<ImageGenResult> {
    // bounded by the outer withTimeout; providers settle quickly in scripted mode
    for (;;) {
      const r = await this.d.provider.imagePoll(job);
      if (!("status" in r)) return r;
    }
  }

  private llmFallback(promptVersion: string, why: string, reasons: string[]): LlmTextResult {
    this.emit("fallback", { capability: "llm", promptVersion, why, reasons });
    return this.d.fallback.llm(promptVersion);
  }

  private timeout(cap: keyof typeof DEFAULT_TIMEOUTS): number {
    return this.d.timeouts?.[cap] ?? DEFAULT_TIMEOUTS[cap];
  }

  private emit(kind: TraceEvent["kind"], payload: Record<string, unknown>): void {
    this.d.trace.record({ at: this.d.now(), kind, payload });
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    t.unref?.();
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e instanceof Error ? e : new Error(String(e))); },
    );
  });
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function parseMemory(text: string): MemoryExtraction {
  try {
    const o = JSON.parse(text) as { key?: unknown; value?: unknown };
    if (typeof o.key === "string" && typeof o.value === "string") return { key: o.key, value: o.value };
  } catch {
    // not JSON → no memory
  }
  return { key: null, value: null };
}
