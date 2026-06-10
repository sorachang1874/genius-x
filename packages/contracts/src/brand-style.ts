/**
 * Brand style contract — typed realization of docs/contracts/brand-style.md (v0 placeholder).
 *
 * THE BINDING RULE: brand style is applied INSIDE the AI gateway on every image generation —
 * lessons and tools carry SCENE CONTENT ONLY, never brand-style language. `styleVersion` is
 * stamped into traces like `promptVersion`, so brand drift is operator-auditable.
 *
 * The VALUES are placeholders (founder decision ① 2026-06-09): the real style kit (reference
 * images / LoRA / palette / per-child conditioning) replaces them when the brand/market
 * design doc lands (DF-v2-18). The TYPE and the injection rule are frozen now so no caller
 * can ever bypass the seam.
 */
export interface BrandStyleContract {
  /** Versioned id, e.g. "style-v0" — stamped in ai_response/fallback traces per image call. */
  styleVersion: string;
  /** Appended to every text2img prompt at the gateway. */
  promptSuffix: string;
  /** Optional negative prompt (v0: unset). */
  negativePrompt?: string;
  /** Brand reference image refs (v0: empty — arrives with the design kit). */
  referenceImageRefs?: string[];
  /** Operator-facing provenance note. */
  notes?: string;
}
