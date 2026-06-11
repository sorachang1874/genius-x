/**
 * Deterministic fallback library — preset, child-appropriate responses served when AI
 * fails/times out/is filtered. Every fallback carries `meta.source:"library", degraded:true`
 * so its use is operator-visible (never a silent normal path). Source: PRD §5.3.3.
 */
import type { LlmTextResult, TtsResult, AsrResult, ImageGenResult, AiMeta } from "@genius-x/contracts";

const META: AiMeta = { source: "library", degraded: true };

// Per prompt-version preset lines (first entry is used — deterministic).
const LLM_FALLBACKS: Record<string, string[]> = {
  icebreak_v1: ["你好呀！我好高兴见到你！你今天开心吗？"],
  talent_v1: ["哇，你真棒！我们一起再玩一个好不好？"],
  birth_speech_v1: ["你好呀！认识你我好开心，下次见！"],
};
const GENERIC_LLM = "我在认真听你说，我们一起继续吧！";

export interface FallbackLibrary {
  llm(promptVersion: string): LlmTextResult;
  tts(): TtsResult;
  asr(): AsrResult;
  /**
   * `seed` (the studentId) rotates the preset pool deterministically per child — degraded
   * classmates rarely collide; the pool size bounds the guarantee (the DF-v2-18 designer
   * set must be ≥ class size for true uniqueness; the seed mechanics stay).
   */
  imageGen(count: number, seed?: string): ImageGenResult;
}

export class PresetFallbackLibrary implements FallbackLibrary {
  llm(promptVersion: string): LlmTextResult {
    const text = LLM_FALLBACKS[promptVersion]?.[0] ?? GENERIC_LLM;
    return { capability: "llm", text, meta: { ...META, promptVersion } };
  }
  tts(): TtsResult {
    return { capability: "tts", audioUrl: "fallback://tts/encouragement.mp3", meta: META };
  }
  asr(): AsrResult {
    return { capability: "asr", transcript: "", meta: META };
  }
  imageGen(count: number, seed?: string): ImageGenResult {
    // Placeholder pool of 8 (designer set replaces it, DF-v2-18). Seedless = offset 0
    // (back-compat); seeded = per-child deterministic rotation.
    const POOL = 8;
    const offset = seed === undefined ? 0 : fnv1a(seed) % POOL;
    const imageUrls = Array.from(
      { length: Math.max(1, count) },
      (_, i) => `fallback://img/preset-${(offset + i) % POOL}.png`,
    );
    return { capability: "image_gen", imageUrls, meta: META };
  }
}

/** Tiny stable string hash (FNV-1a, 32-bit) — determinism only, no crypto. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
