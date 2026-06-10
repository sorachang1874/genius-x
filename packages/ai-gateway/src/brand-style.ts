/**
 * Brand style v0 — the PLACEHOLDER value (docs/contracts/brand-style.md, DF-v2-18).
 *
 * The suffix below was extracted verbatim from lesson-001's former inline promptAssembly
 * string — it is explicitly NOT a brand decision. When the founder's brand/market design
 * doc lands, this file is replaced (style kit: reference images / LoRA / palette /
 * negative prompts) under a new styleVersion; the injection seam in gateway.ts and the
 * trace stamping stay exactly as they are.
 */
import type { BrandStyleContract } from "@genius-x/contracts";

export const BRAND_STYLE_V0: BrandStyleContract = {
  styleVersion: "style-v0",
  // The old inline string also carried 白色背景, which CONTRADICTED the scene's own
  // {background} answer (森林/太空) — dropped here so the suffix never fights the scene;
  // recorded in brand-style.md v0 notes for the brand design doc to resolve deliberately.
  promptSuffix: "儿童插画风格，鲜艳色彩",
  notes: "placeholder extracted from lesson-001 promptAssembly (2026-06-09; 白色背景 dropped — contradicted the scene background); replace on brand design doc (DF-v2-18)",
};
