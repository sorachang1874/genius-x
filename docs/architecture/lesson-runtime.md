# Lesson Runtime — generic, config-driven engine

> Status: **proposed, pending approval**. Supersedes the Lesson-1-specific machine in the
> C-M1 design note. Realizes PRD §4.2: new lessons are config, **zero engine change**.

## Principle

The engine interprets `LessonConfig`; it **never special-cases a specific lesson's stages**.
No stage name (`icebreak`/`shape`/…) appears in engine code. Lessons 2-16 and CMS-authored
lessons are just data in the same schema. This is what makes a course-design platform possible.

## Model

A lesson is an ordered list of **stages** (a sequence now; can become a graph later). Each
stage declares, in config, everything the generic engine needs:

- `id`, `name`, `duration`
- `unlock` — which role may advance into/out of it (generalized `unlockBy`)
- `advanceCondition` — a **declarative** gate to leave the stage, evaluated generically
- `interaction?` — optional AI interaction spec (the existing `AiInteraction` union)
- `appState?` / `output?`

## Generic engine

- **State:** `{ lesson, currentStageIndex, students: Record<id, StudentRuntimeState>, … }`.
- **Pure reducer:** `(state, event) => state`. Events: `UNLOCK{role}`, `STUDENT_COMPLETE`, `GLOBAL`.
- **Advance:** on `UNLOCK`, if `role` satisfies the unlock policy **and** the current stage's
  `advanceCondition` holds (per a generic evaluator) → `currentStageIndex++`.
- **Guard registry:** `advanceCondition.type → evaluator(state, stage) => boolean`. A small,
  bounded, extensible vocabulary — engine code is generic over it.
- Pure + serializable → trivial persistence/resume + unit testing.

## Declarative advance-condition vocabulary (v1)

| `type` | meaning | Lesson-1 use |
| --- | --- | --- |
| `immediate` | advance on unlock alone | intro, icebreak |
| `assistantConfirm` | assistant explicitly confirms | (generic) |
| `fieldSet{ field }` | a per-student field is set | shape (avatar selected) |
| `minInteractions{ count }` | student did ≥ count interactions | talent |
| `allStudents{ status }` | all students reached a status | birth (all completed) |

New lessons **compose these in config**. Adding a *new* condition type is a rare
contract+engine change; authoring a new lesson is not.

## Unlock / management framework

- `unlockPolicy: "classWide"` (default, v1 implemented) `| "perAssistantGroup"` (later).
  Defines the **scope** an unlock applies to.
- The engine consults a **policy resolver**; v1 ships `classWide` only, but the field +
  interface exist so switching is *config + an added resolver*, not a rearchitecture.
- Lesson-level default; stage-level override allowed later. Both granularities are first-class
  in the model even though only one is implemented now.

## Contract evolution (LessonConfig v1)

This evolves the just-frozen contracts v0 (only `lesson-001.ts` consumes it — cheap to get
right **now**, before any engine code). Via lead re-serialization → re-tag `contracts-v1`:

- add `StageConfig.advanceCondition` (declarative), `LessonConfig.unlockPolicy`
- generalize `unlockBy` → `unlock`
- re-author `lesson-001` as **instance #1** of the generic schema (the typecheck stays the
  contract preflight)

## Why now (CMS alignment)

Payload CMS will edit exactly these configs (stages + declarative conditions + policy). A
generic engine interprets them with no per-lesson code — so the course-design platform works
by construction. Hardcoding Lesson 1 would have blocked that.

## Decisions to confirm

1. **Advance-condition vocabulary** above — right shape / sufficient to start?
2. **Engine substrate:** a generic **pure reducer** (recommended — most generic, CMS-friendly,
   easy to persist/test) vs dynamically building an XState machine from config. XState can
   still wrap the reducer for persistence/visualization if wanted.

## Out of scope for v1 (named so they're not forgotten)

Stage graph/branching (vs linear) · per-group unlock resolver · timed auto-advance · stage
skip/replay. All expressible as later extensions of this same schema.
