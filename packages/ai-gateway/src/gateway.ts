/**
 * AiGateway — the single entry point for AI. Each capability runs:
 *   input safety → timeout-bounded provider call → output schema-validation → output safety
 *   → fallback on ANY fail/timeout/filtered/schema-miss (meta.degraded, audited).
 * It NEVER throws to the caller (incl. if the TraceSink throws — trace is shadow). AiMeta
 * stays here + in traces (not shipped to the child). See D-M2 design / data-and-privacy.
 */
import type {
  BrandStyleContract,
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
  ImageJob,
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
  /** Image moderation seam (天御 IMS in M6). If omitted, M2a traces that it is deferred. */
  imageModerator?: (imageUrls: string[]) => Promise<{ ok: boolean; reasons: string[] }>;
  /**
   * Brand style contract (docs/contracts/brand-style.md): applied INSIDE the gateway to
   * EVERY image generation — lessons/tools carry scene content only, no caller can bypass.
   * If omitted, every image call traces `brand_style_absent` (a deployment state, never a
   * silent normal path — the moderation_deferred_m6 pattern).
   */
  brandStyle?: BrandStyleContract;
}

const DEFAULT_TIMEOUTS = { llm: 8000, tts: 2000, asr: 8000, image: 15000 };

export class AiGateway {
  constructor(private readonly d: GatewayDeps) {}

  async llm(req: LlmRequest): Promise<LlmTextResult> {
    const input = this.d.safety.reviewInput(req.input);
    if (!input.ok) return this.llmFallback(req.promptVersion, "input_filtered", input.reasons);
    try {
      const r = await withTimeout(this.d.provider.llm(req), this.timeout("llm"));
      assertLlm(r);
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
      const r = await withTimeout(this.d.provider.tts(req), this.timeout("tts"));
      assertTts(r);
      this.emit("ai_response", { capability: "tts" });
      return r;
    } catch (e) {
      this.emit("fallback", { capability: "tts", reason: reason(e) });
      return this.d.fallback.tts();
    }
  }

  async asr(req: AsrRequest): Promise<AsrResult> {
    try {
      const r = await withTimeout(this.d.provider.asr(req), this.timeout("asr"));
      assertAsr(r);
      this.emit("ai_response", { capability: "asr" });
      return r;
    } catch (e) {
      this.emit("fallback", { capability: "asr", reason: reason(e) });
      return this.d.fallback.asr();
    }
  }

  async imageGen(req: ImageGenRequest): Promise<ImageGenResult> {
    const styleVersion = this.d.brandStyle?.styleVersion;
    // PRE-SUBMIT input review (brand-style.md "Pre-submit input review" / agent-context.md
    // safety parity): a text2img source is PROSE that may embed client-derived content —
    // review it like llm input. img2img sources are refs, not prose (no review point; the
    // post-generation imageModerator covers the output side).
    if (req.kind === "text2img") {
      const input = this.d.safety.reviewInput(req.source);
      if (!input.ok) {
        this.emit("safety", { capability: "image_gen", reasons: input.reasons });
        this.emit("fallback", { capability: "image_gen", reason: "input_filtered", ...(styleVersion && { styleVersion }) });
        return this.d.fallback.imageGen(req.count);
      }
    }
    // Brand style (brand-style.md): the ONE injection point no image call can bypass.
    // text2img gets the versioned suffix appended (AFTER review — the suffix is ours, the
    // review targets the caller's content); img2img is version-stamped in traces only
    // (prompt-level styling lands with the real style kit, DF-v2-18). Absence is LOUD.
    const styled: ImageGenRequest =
      this.d.brandStyle && req.kind === "text2img"
        ? { ...req, source: req.source === "" ? this.d.brandStyle.promptSuffix : `${req.source}，${this.d.brandStyle.promptSuffix}` }
        : req;
    if (!this.d.brandStyle) {
      this.emit("interaction", { capability: "image_gen", note: "brand_style_absent" });
    }
    // ONE end-to-end deadline for the whole capability (submit + poll + moderate) ≤ budget.
    const deadline = Date.now() + this.timeout("image");
    const remaining = (): number => Math.max(0, deadline - Date.now());
    try {
      const job = await withTimeout(this.d.provider.imageSubmit(styled), remaining());
      const r = await this.pollImage(job, deadline);
      assertImage(r);
      // Moderate before returning (天御 IMS). M2a: seam present; real moderator injected in M6.
      if (this.d.imageModerator) {
        const mod = await withTimeout(this.d.imageModerator(r.imageUrls), remaining());
        if (!mod.ok) {
          this.emit("safety", { capability: "image_gen", reasons: mod.reasons });
          this.emit("fallback", { capability: "image_gen", reason: "image_moderation_failed", ...(styleVersion && { styleVersion }) });
          return this.d.fallback.imageGen(req.count);
        }
      } else {
        this.emit("interaction", { capability: "image_gen", note: "moderation_deferred_m6" });
      }
      this.emit("ai_response", { capability: "image_gen", ...(styleVersion && { styleVersion }) });
      return r;
    } catch (e) {
      // Degraded generations are still brand-attributed (preset fallbacks carry the brand
      // version they were served under — conformance audits need this).
      this.emit("fallback", { capability: "image_gen", reason: reason(e), ...(styleVersion && { styleVersion }) });
      return this.d.fallback.imageGen(req.count);
    }
  }

  /** Extract a memory point. Input-safety the transcript first; key MUST be lesson-declared. */
  async extractMemory(req: ExtractMemoryRequest): Promise<MemoryExtraction> {
    const input = this.d.safety.reviewInput(req.transcript);
    if (!input.ok) {
      this.emit("safety", { capability: "extract_memory", reasons: input.reasons });
      return { key: null, value: null };
    }
    try {
      const r = await withTimeout(
        this.d.provider.llm({ promptVersion: req.promptVersion, input: req.transcript }),
        this.timeout("llm"),
      );
      assertLlm(r);
      const parsed = parseMemory(r.text);
      if (parsed === null) {
        this.emit("interaction", { reason: "memory_schema_miss" });
        return { key: null, value: null };
      }
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

  /** Poll for an image result up to an absolute deadline (never spins forever; each poll bounded). */
  private async pollImage(job: ImageJob, deadline: number): Promise<ImageGenResult> {
    const step = Math.min(200, Math.max(10, Math.floor(this.timeout("image") / 50)));
    for (let attempts = 0; attempts < 200; attempts++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      // bound EACH poll too, so a never-settling poll promise can't hang past the deadline
      const r = await withTimeout(this.d.provider.imagePoll(job), remaining);
      if (!("status" in r)) return r;
      await delay(Math.min(step, Math.max(0, deadline - Date.now())));
    }
    throw new Error("image_poll_timeout");
  }

  private llmFallback(promptVersion: string, why: string, reasons: string[]): LlmTextResult {
    this.emit("fallback", { capability: "llm", promptVersion, why, reasons });
    return this.d.fallback.llm(promptVersion);
  }

  private timeout(cap: keyof typeof DEFAULT_TIMEOUTS): number {
    return this.d.timeouts?.[cap] ?? DEFAULT_TIMEOUTS[cap];
  }

  /** Audit. Trace is a SHADOW sink — a throwing/broken sink must never break the classroom. */
  private emit(kind: TraceEvent["kind"], payload: Record<string, unknown>): void {
    try {
      this.d.trace.record({ at: this.d.now(), kind, payload });
    } catch {
      // swallow: trace failures must not surface to the caller
    }
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

function delay(ms: number): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    t.unref?.();
  });
}

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// --- runtime output validators (provider schema-miss → throw → fallback) ---
function validMeta(m: unknown): boolean {
  const o = m as { source?: unknown; degraded?: unknown } | null;
  return (
    !!o &&
    (o.source === "primary" || o.source === "fallback" || o.source === "library") &&
    typeof o.degraded === "boolean"
  );
}
function assertLlm(r: unknown): asserts r is LlmTextResult {
  const o = r as Partial<LlmTextResult> | null;
  if (!o || o.capability !== "llm" || typeof o.text !== "string" || !validMeta(o.meta)) throw new Error("schema_miss:llm");
}
function assertTts(r: unknown): asserts r is TtsResult {
  const o = r as Partial<TtsResult> | null;
  if (!o || o.capability !== "tts" || typeof o.audioUrl !== "string" || !validMeta(o.meta)) throw new Error("schema_miss:tts");
}
function assertAsr(r: unknown): asserts r is AsrResult {
  const o = r as Partial<AsrResult> | null;
  if (!o || o.capability !== "asr" || typeof o.transcript !== "string" || !validMeta(o.meta)) throw new Error("schema_miss:asr");
}
function assertImage(r: unknown): asserts r is ImageGenResult {
  const o = r as Partial<ImageGenResult> | null;
  if (
    !o ||
    o.capability !== "image_gen" ||
    !Array.isArray(o.imageUrls) ||
    !o.imageUrls.every((u) => typeof u === "string") ||
    !validMeta(o.meta)
  ) {
    throw new Error("schema_miss:image");
  }
}

/** Parse the memory JSON. null = schema miss (not valid {key:string,value:string} or {key:null}). */
function parseMemory(text: string): MemoryExtraction | null {
  try {
    const o = JSON.parse(text) as { key?: unknown; value?: unknown };
    if (typeof o.key === "string" && typeof o.value === "string") return { key: o.key, value: o.value };
    if (o.key === null) return { key: null, value: null };
  } catch {
    // not JSON
  }
  return null;
}
