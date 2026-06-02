# Lesson Runtime — generic, config-driven engine (v2)

> Status: **revised after independent review** (which found 3 blockers in v1). Pending
> approval. Decisions resolved: **substrate = pure reducer**; **conditions = composable +
> scoped**. Realizes PRD §4.2 (new lessons = config, zero engine change).

## What v1 got wrong (independent review)

1. Conditions couldn't express Lesson 1 — shape/talent advance on **compound** (AND) gates.
2. **Per-student vs class scope** conflated (fieldSet/minInteractions are per-student; engine
   had one class cursor + all-or-nothing `allStudents`).
3. Closed `StageId` enum **leaked into the frozen wire/session contract** — a CMS lesson's
   stage names couldn't be represented. v2 fixes all three.

## Principle

The engine interprets `LessonConfig`; no stage name appears in engine code. Stages are data.

## Model

- Lesson = ordered stages. Advance via `nextStageId(state)` indirection (**not** `index++`) —
  keeps branching open later.
- Persist by **`currentStageId` (string)** + `lessonConfigVersion`; resume fails closed on
  version mismatch (no silent skew).
- One class-wide cursor (`currentStageId`) + a **typed** per-student `StudentRuntimeState`.

## Generic engine

- **Pure reducer** `(state, event) => state`. Events: `UNLOCK{role}`, `STUDENT_COMPLETE`,
  `INTERACTION_DONE{studentId, stageId, degraded}`, `GLOBAL`, `FORCE_ADVANCE` (assistant override).
- **Guard evaluator:** `(ctx) => boolean`, `ctx = { state, stage, now, events }` — a **struct**
  so new inputs are additive, never a global signature change.
- **Registries are the single source of valid `type`s:** condition evaluators (now),
  interaction handlers (M3). Unknown type ⇒ rejected at config load, not a runtime stall.

## Conditions — composable + scoped

```
StudentPredicate  (per student):  fieldSet{ field: RuntimeFieldKey } | minInteractions{ count }
AdvanceCondition  (gates a stage): immediate
                                 | allStudents{ of: StudentPredicate }
                                 | countStudents{ min, of: StudentPredicate }
                                 | all{ conditions: AdvanceCondition[] }
                                 | any{ conditions: AdvanceCondition[] }
```

- **Composition** (`all`/`any`) expresses Lesson 1's compound gates.
- **Scope** explicit: per-student predicate wrapped by a class aggregate.
- `fieldSet.field` is **typed** (`keyof StudentRuntimeState`) — no stringly-typed coupling.
- "Assistant confirm" is **folded into the `UNLOCK` event** (dropped as a condition).

Lesson-1 mapping: intro/icebreak = `immediate` (assistant unlock); shape→talent = unlock +
`allStudents{ fieldSet:"avatarUrl" }` (or `immediate` + per-student readiness shown to the
assistant — see semantics); talent→birth = unlock + `countStudents{ min:N, of: minInteractions{2} }`;
birth→closure = `allStudents{ status:"completed" }`.

## Unlock / advance semantics (straggler-safe)

- Leaving a stage requires: `UNLOCK` by the stage's role **and** its `advanceCondition` holds.
- The assistant is the human gate; `advanceCondition` encodes product-mandated hard rules.
- **`FORCE_ADVANCE`** = explicit, logged assistant override so one straggler never freezes the
  class (operator-visible).
- `unlockPolicy: "classWide"` (default, the only one implemented). Keep the field for
  forward-compat; **drop the resolver/override machinery** (no consumer yet — add with perGroup).

## AI interactions as events (not special cases)

The interaction layer (M3) emits `INTERACTION_DONE` into the reducer; `minInteractions` counts
these. A fallback (AI failed, `degraded:true`) **still counts** — the engine stays generic over AI.

## Config validation (runtime twin of `tsc`)

A **Zod validator** runs on every config load (git or CMS). The condition + interaction
registries define the valid `type`s, so unknown type / dangling `fieldSet` field / unreachable
stage = **load-time rejection, fail closed**. Never a silent in-class stall.

## Contracts v1 change set (apply via lead re-serialization → re-tag `contracts-v1`)

- `ws-events` + `student`: `stageId` / `currentStage` → **`string`** (opaque, validated), not
  the closed `StageId` enum. Generalize `GLOBAL_STATE`.
- `StudentSessionState`: typed `StudentRuntimeState` (with `RuntimeFieldKey`) instead of the
  untyped `stageData` bag.
- `course-config`: `StageConfig.advanceCondition` (composable union), `unlockBy` → `unlock`;
  `LessonConfig.unlockPolicy` + `lessonConfigVersion`.
- Keep `StageId` only as a Lesson-1 documentation alias.
- Re-author `lesson-001` as instance #1 (tsc preflight) + add the Zod validator.

## Decisions (resolved)

1. **Conditions:** discriminated union + evaluator registry + Zod validator; composable
   (`all`/`any`) + scoped (`allStudents`/`countStudents` over `StudentPredicate`); typed
   `fieldSet`; evaluator **context struct**.
2. **Substrate:** **pure reducer.** Not XState-from-config (its value is anti-aligned with a
   runtime-data-defined flow; reducer state serializes cleanly for resume). Update
   `course-engine.md` (which still says "XState").

## Out of scope v1 (named, additive on this schema)

Stage graph/branching · per-group unlock resolver · timed auto-advance · stage skip/replay.
