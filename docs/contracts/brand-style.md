# Brand Style Contract (v0 placeholder)

**Status**: Frozen v0 — **placeholder by design** (founder decision ①: simple start;
the real style kit replaces the placeholder when the brand/market design doc lands —
DF-v2-18). The INJECTION RULE below is binding now; the style VALUES are placeholders.
**Owner**: AI gateway (Agent D) — injection + stamping; brand asset values — founder/design
(external); conformance checks (post-gen) — Agent J (Phase 7)
**Typed realization**: `packages/contracts/src/brand-style.ts`; v0 value in
`packages/ai-gateway/src/brand-style.ts`
**Companion contracts**: [`ip-character.md`](ip-character.md) (per-child consistency side),
[`agent-context.md`](agent-context.md), `docs/product/ip-character-concept-decisions.md`
**Last updated**: 2026-06-09

---

## Purpose

Every generated artifact must be **recognizably Genius X brand-derived** (统一品牌风格与
调性) — across children and across one child's course stages. Brand style is enforced at
the **one chokepoint every image call already passes through** (`AiGateway.imageGen`), so
no lesson, tool, or future caller can omit or override it.

## The binding rules (v0 and forever)

1. **Gateway-level injection**: brand style is applied INSIDE the gateway, per call.
   Lesson configs and tools carry **scene content only** — never brand-style language.
   (lesson-001's `promptAssembly` was the one style string in the system; it is now scene
   content only, the style suffix lives here.)
2. **Versioned like a prompt contract**: `styleVersion` (e.g. `"style-v0"`) is stamped into
   the gateway's `ai_response`/`fallback` traces for every image call — brand drift is
   operator-auditable exactly like `promptVersion`.
3. **Absence is loud**: a gateway built without a brand style contract traces
   `brand_style_absent` on every image call (the `moderation_deferred_m6` pattern) — a
   deployment state, never a silent normal path.
4. **No bypass vector**: Phase 5 tool-calling routes image generation through this same
   gateway path; a tool's "style" parameter is a child-facing creative variation COMPOSED
   WITHIN the brand contract, never a replacement (binds the v2 architecture's tool design).

## Shape (typed, v1 of the type — values are v0)

```ts
interface BrandStyleContract {
  styleVersion: string;            // "style-v0"
  promptSuffix: string;            // appended to every text2img prompt
  negativePrompt?: string;         // v0: unset
  referenceImageRefs?: string[];   // v0: empty — real refs arrive with the design kit
  notes?: string;                  // operator-facing provenance
}
```

**v0 placeholder value** (extracted from lesson-001's former inline string — explicitly
NOT a brand decision): `promptSuffix = "儿童插画风格，鲜艳色彩"`. The original string also
carried `白色背景`, which **contradicted the scene's own `{background}` answer** (森林/太空)
— dropped at extraction; the brand design doc resolves background policy deliberately
(recorded in `BRAND_STYLE_V0.notes` + DF-v2-18).

### img2img semantics (v0)

img2img calls (the doodle variant) are **stamped-but-unstyled**: `styleVersion` in their
traces means "the brand contract was in force", NOT "a style suffix was applied" (a ref is
not a prompt). Prompt-level styling for image-conditioned generation arrives with the real
style kit (reference images / LoRA, DF-v2-18). Conformance audits must read the stamp with
this semantic.

### Pre-submit input review (IMPLEMENTED, owner D)

Before suffixing and submitting, the gateway runs `safety.reviewInput` on every
**text2img source** (it is prose that may embed client-derived content): filtered ⇒
`safety` trace + `fallback` trace (styleVersion-stamped) + preset fallback images — the
child still gets a positive output. img2img sources are refs (no prose to review); the
post-generation `imageModerator` seam covers the output side. This makes the image path
structurally identical to the text path: review → transform-per-contract → call → gate →
fallback. Cross-referenced from agent-context.md safety-parity item 4.

## What replaces v0 (trigger: founder's brand/market design doc)

Style kit (reference image set / LoRA / palette) + per-child character conditioning
(`appearanceRef` from [`ip-character.md`](ip-character.md)) + designer fallback avatar set
(**per-child distinct** — degraded children must never receive identical "personal"
friends; assignment seeded by studentId, DF-v2-18 replacement scope) + aesthetic eval set
(promptfoo, Agent F tooling) + enforcement-tier decision (prompt-prefix / reference-image /
fine-tune — constrains DF-1 provider choice).

## Scene-content assembly (the fixed bug, owned by C)

`structured_qa.promptAssembly` is a SCENE template (`"… {ears} …，{accessory}，
{background}背景"`): the controller substitutes `{questionId}` → the child's chosen option
and submits the assembled prompt (previously dead config — raw answer JSON went to the
provider). Missing answer for a referenced token ⇒ token replaced with empty string +
`prompt_assembly_missing_answer` trace (countable, never a crash).

## Owner matrix

| Field | Owner | Source of truth | Allowed values | Derivation | Consumers | Fallback | Deletion | Preflight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `styleVersion` | D | gateway dep (composition root) | versioned ids | injected constant | traces, future `aiParams` stamping (DF-v2-14) | absent ⇒ `brand_style_absent` trace per call | superseded versions kept in git history | trace assertion test |
| `promptSuffix` | founder/design (value), D (application) | `packages/ai-gateway/src/brand-style.ts` (git-versioned) | non-empty string | appended at gateway to text2img | provider | n/a | replaced at brand rev | lesson configs contain NO style keywords (grep preflight) |
| Scene `promptAssembly` | C (assembly), lesson author (template) | lesson config | template with `{questionId}` tokens | substituted in controller | gateway `source` | missing answer ⇒ empty + trace | with lesson rev | validator: tokens ⊆ question ids |

## Failure modes

| Scenario | Behavior |
| --- | --- |
| Brand contract not injected | Generation proceeds un-styled; `brand_style_absent` traced per call (deployment state, operator-visible) |
| Assembly token without answer | Empty substitution + trace; generation proceeds (no visible child failure) |
| Future: style conformance check fails (Phase 7) | Operator-flagged, never blocks the classroom (degradation principle) |

## Validation & preflight

- Gateway test: text2img source ends with the suffix; `styleVersion` present in the
  `ai_response` trace AND in `fallback` traces (degraded generations are still
  brand-attributed).
- Gateway-without-brand test: `brand_style_absent` traced.
- Controller test: `answers` input produces the assembled prompt (not JSON) at the provider
  boundary; missing-answer trace pinned.
- Validator (ALL implemented in `validate.ts`, fail closed): `promptAssembly` tokens must
  reference declared question ids; question ids must be tokenizable (`/^[A-Za-z0-9_]+$/`)
  when a template exists; no residual braces (malformed tokens); **no brand-style
  vocabulary in `promptAssembly`** — the enumerated denylist is
  `风格|色彩|插画|画风|水彩|像素` (one source: `BRAND_STYLE_VOCABULARY_RE` in validate.ts) —
  style lives here only.
- Controller: substituted answer values must be the question's DECLARED options — a
  client-supplied non-option substitutes "" + `prompt_assembly_answer_not_an_option` trace
  (ids only, never values). Free text cannot reach the prompt.

## Changelog

- **v0** (2026-06-09): injection rule + trace stamping + scene/brand split frozen; style
  VALUES are placeholders pending the brand design doc (DF-v2-18).

_Brand Style Contract · v0 placeholder · 2026-06-09_
