# Scene Contract (Phase 5)

**Status**: Frozen v1 (implementation: Phase 5 Step 2 — engine slice)
**Owner**: Course runtime (Agent C) — **lead decision 2026-06-10**: scene runtime IS the
stage machine (engine/reducer/config); the Agent service (I) is a CONSUMER (buffer keys,
consolidation — already pinned `scene == stage` in [`agent-context.md`](agent-context.md))
**Typed realization**: `packages/contracts/src/course-config.ts` (additive fields)
**Companion contracts**: [`agent-context.md`](agent-context.md), [`tool.md`](tool.md),
[`brand-style.md`](brand-style.md), `docs/product/ip-character-concept-decisions.md`(决策⑤)
**Last updated**: 2026-06-10

---

## Purpose

The course direction (founder decision ⑤, option 2): **teacher = scene designer** — scenes
are PRE-AUTHORED into the validated lesson config (备课), and the teacher SELECTS which
scene runs next during class. NOT free live composition (conflicts with child-safety
review and prompt-contract discipline — capped deliberately, see the realignment doc).

## The model (scene == stage, formalized)

- A **scene IS a stage**: `(sessionId, studentId, stageId)` keys the turn buffer, episodic
  consolidation fires at stage exit, round caps/counters are stage-scoped — ALL of Phase
  4's scene machinery applies unchanged. A future `sceneId` (one stage hosting several
  scenes) remains the additive escape hatch declared in agent-context.md.
- A **lesson MAY declare more scenes than will run**: the library is the validated config;
  selection happens in class.

## Scene selection (the ONE engine change)

| Property | Rule |
| --- | --- |
| `StageConfig.next?: StageId[]` | Declared allowed successors. **Absent = linear** (the implicit index+1 — every existing lesson is 100% unchanged). `[]` = terminal stage |
| Selection | The EXISTING unlock protocol: `ASSISTANT_UNLOCK`/`TEACHER_UNLOCK` already carry the target `stageId` — the engine accepts any target **∈ the current stage's allowed successors** (was: strictly the next index). FORCE_ADVANCE: same successor rule (an operator override still cannot jump arbitrarily) |
| Lesson complete | The class transitioned INTO a **terminal stage** (computed successors empty). The validator enforces: exactly one terminal stage, reachable from the first stage, and every stage reaches the terminal (no dead ends — fail closed) |
| Advance conditions | Unchanged per stage — selection chooses WHICH successor, the gate still decides WHEN |
| Skipped scenes | Never entered ⇒ no buffers, no works, no counters — correctly nothing (not holes; the FORCE-ADVANCE hole semantics apply only to entered-then-skipped artifact stages) |

## Mechanics × prompts (the expectation, binding on course production)

A scene = a REUSABLE MECHANIC (engine-coded interaction type) × CONTENT (prompts/options/
declared ids in config). New scenes from existing mechanics are **pure config** (fast,
no engineering cycle); a genuinely NEW mechanic is an engineering cycle through the lead —
the correct child-safety posture, not a limitation. Phase-5 mechanics inventory: the five
existing interaction types + `image_refine` (tool.md — the iterative aesthetics loop).

## Client surfaces (deferred-with-note)

The assistant panel currently computes "next" as the linear successor of the hardcoded
lesson-001 — correct for every linear lesson, untouched by this contract. A
SUCCESSOR-CHOICE UI (the teacher's scene picker, Agent A) ships with the first branching
lesson's content — the PROTOCOL already supports it (unlock messages carry the target).

## Validation & preflight

- `next` refs exist; exactly one terminal; all stages reach the terminal; first stage can
  reach every declared scene (unreachable scenes fail closed — dead config is drift).
- Linear lessons (no `next` anywhere) validate exactly as before (back-compat pinned).

## Changelog

- **v1** (2026-06-10): initial freeze — scene==stage formalization, library + in-class
  selection via declared successors, terminal-stage completion, mechanics×prompts rule.

_Scene Contract · Phase 5 · Frozen v1 · 2026-06-10_
