# Tool Contract (Phase 5)

**Status**: Frozen v1 (implementation: Phase 5 Step 3 — dispatch slice)
**Owner**: AI gateway (Agent D) — dispatch binding; Course runtime (C) — invocation path;
tool DEFINITIONS = versioned git config (lesson-declared, validated like prompts)
**Typed realization**: `packages/contracts/src/tool.ts`
**Companion contracts**: [`scene.md`](scene.md) (tools live INSIDE scenes),
[`brand-style.md`](brand-style.md) (the composition rule), [`workspace.md`](workspace.md)
(interaction-record provenance), `docs/product/ip-character-concept-decisions.md`
**Last updated**: 2026-06-10

---

## Purpose

Tools are **in-scene creation instruments** (the 2026-06-09 realignment — NOT a free
discovery marketplace yet): a scene declares which tools a child may use; using one
produces/refines a WORK through the same safety/brand/budget machinery as everything else.
The first concrete mechanic is **`image_refine`** — "把这一张变成那样" — the iterative
aesthetics loop the IP concept centers on (child picks a candidate, asks for a variation,
judges the result: 辨别质量、不断改进 — founder decision ⑨'s educational core).

## The BINDING rules (narrowing the v2 sketch — lead-serialized 2026-06-10)

1. **Every tool invocation routes through `AiGateway`** — the v2 sketch's free-form
   `capability.endpoint` is REJECTED; a tool's capability is a CLOSED enum of gateway
   mechanics (`image_create | image_refine | story_chat`). No tool can name a URL,
   provider, or workflow id. (Brand/safety/budget enforcement stays at the one chokepoint.)
2. **Brand composition** (binds the v2 doc per the P4 audit): a tool's style options are
   child-facing creative VARIATIONS composed WITHIN the brand contract — the gateway
   appends the brand suffix to whatever the tool assembles; no tool parameter can replace
   or suppress it.
3. **No free text into prompts**: tool inputs are DECLARED option ids + work/candidate
   REFS (the structured_qa pattern); the controller assembles prompts from declared
   values only. (The gateway's pre-submit review remains the backstop.)
4. **Child-facing names are copy, bound by the banned-wording rule** (no AI/模型 etc.);
   tool ids are opaque internals that never render to a child.
5. **Provenance** (Phase-5 shape, lead-serialized): the INTERACTION RECORD is the
   provenance — a refine exchange persists `input {kind:"refine", toolId, optionId}` +
   the candidate URLs (the Phase-2 recorder, unchanged), and usage is counted via traces
   (`tool_refine_ok` / `tool_refine_degraded` / `tool_denied` + toolId/version). The
   denormalized `works.tool_used` column joins WHEN the work-recording path gains
   candidate-set provenance (the selection that records a work does not yet know which
   tool produced the picked URL — deferred with this note, not silently). A dedicated
   `ToolUsage` table stays deferred until an analytics consumer exists (founder ⑨).
6. **Discovery conditions** (minAge/phase/prerequisites from the v2 sketch) are DEFERRED:
   Phase-5 availability = the scene declares it (`StageConfig.tools`), nothing else.

## Tool definition (versioned git config, validated fail-closed)

```ts
interface ToolDefinition {
  toolId: string;            // opaque internal id (never child-rendered)
  version: string;           // like promptVersion — traced on every invocation
  childName: string;         // child-facing copy (banned-wording test applies)
  mechanic: "image_create" | "image_refine" | "story_chat"; // CLOSED gateway-bound enum
  /** Declared child-pickable variation options (ids + child copy) — the ONLY inputs. */
  options?: { id: string; label: string; promptFragment: string }[];
  // NOTE (v1, lead-serialized): per-tool maxRounds was REMOVED — round limits are the
  // SCENE's: `image_gen.maxRounds` (lesson config, ENFORCED via the CAP_REACHED warm
  // wrap-up exactly like voice_chat.maxTurns). A per-tool counter returns only with a
  // per-tool enforcer.
}
```

Registry = `packages/course-config/src/tools.ts` (git, versioned, validated at boot with
the lesson: every `StageConfig.tools` ref must resolve; option promptFragments must pass
the brand-vocabulary denylist — scene content only, like promptAssembly).

## The `image_refine` flow (the Step-3 deliverable)

```
child picks a prior candidate/work → taps a tool variation (declared option)
  → INTERACT { kind: "refine", baseImageRef, toolId, optionId }
  → reducer gates: stage declares the tool + the scene's round cap (image_gen.maxRounds,
    ENFORCED via CAP_REACHED); controller resolves: registry / option / ownership
  → controller assembles: option.promptFragment (scene content only)
  → gateway img2img { source: baseImageRef, prompt fragment + BRAND suffix, seed: studentId }
  → candidates back → child picks → work records (provenance = the refine interaction record, rule 5; + ipCharacterVersion lineage)
```

`baseImageRef` (Phase-5 v1) accepts the student's OWN recorded work id ONLY (ownership
validated; same-student pointer discipline). Refining an in-flight candidate URL — before
the child commits it as a work — is the next slice (requires server-side candidate-set
tracking; deferred with this note).

## Owner matrix

| Field | Owner | Source of truth | Allowed values | Derivation | Consumers | Fallback | Deletion | Preflight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ToolDefinition` | course production (values), lead (freeze) | git registry | closed mechanics enum | authored | validator, runtime, child UI copy | unresolvable ref ⇒ boot fails closed | versioned, superseded kept in git | every `StageConfig.tools` ref resolves; banned-wording on childName; brand-vocab denylist on fragments |
| `StageConfig.tools?` | lesson author | lesson config | declared tool ids | config | reducer (deny undeclared), child UI | absent = no tools in scene | with lesson rev | refs resolve (validator) |
| provenance (P5 = interaction record) | C (writer), H (storage) | `interactions` input JSON (`toolId`/`optionId`) + traces | declared ids | the refine exchange | analytics (⑨), Phase-6 surfaces | n/a | retention | refine interaction persists toolId (test); `works.tool_used` denormalization deferred (see rule 5) |
| invocation traces | C/D | trace sink | `tool_invoked/_refine_ok/_denied` + toolId/version | runtime | operator metrics | n/a | n/a | counted in tests |

## Failure modes

| Scenario | Behavior |
| --- | --- |
| Tool/option not declared on the stage | Deny-with-trace (`tool_denied`, ids only); child sees the friend's warm redirect (the cap-wrap-up pattern), never a dead button |
| Gateway degraded | Preset fallback images (seeded per child) — same as every image path |
| baseImageRef outside the student's reach | Denied + traced (same-student pointer discipline) |
| Registry/lesson mismatch | Boot fails closed (validator) — never a half-wired classroom |

## Changelog

- **v1** (2026-06-10): initial freeze — closed gateway-bound mechanics, brand composition
  rule, no-free-text inputs, provenance = the interaction record (works.tool_used
  denormalization + ToolUsage table + discovery conditions + per-tool maxRounds all
  deferred-with-notes; lead-serialized narrowings of the v2 sketch).

_Tool Contract · Phase 5 · Frozen v1 · 2026-06-10_
