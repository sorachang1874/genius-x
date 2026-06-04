# Lesson Runtime — generic, config-driven engine

> Status: **applied as contracts-v1** (typechecks; tag `contracts-v1`). Refined across two
> independent reviews (Claude + Codex/gpt-5.5) that caught blockers in v1/v2. Realizes PRD
> §4.2: new lessons = config, **zero engine code change**.

## Principle

The engine interprets `LessonConfig`; no stage/memory/artifact/output **name** appears in
engine code or in frozen wire/persistence types. They are **opaque ids validated at runtime**
against the loaded lesson (a closed enum would mean "the system only knows Lesson 1").

## Opaque ids (vs closed enums)

`StageId`, `MemoryKey`, `ArtifactType`, `OutputKey` are `string`, validated against the
lesson's `declared*` lists. Lesson-1 unions survive only as documentation/test aliases
(`Lesson1StageId`, …). This is what lets the CMS add stages/outputs without a contract migration.

## Engine

- **Pure reducer** `(state, EngineEvent) => { state, EngineCommand[] }`. Events + effect-
  commands (`CALL_INTERACTION`, `BROADCAST`, `PERSIST`, `TRACE`) are **typed in
  `@genius-x/contracts` (`engine.ts`)** — AI calls / sockets / DB never leak into reducer
  logic, and agents can't invent incompatible shapes. (Not XState: the chart is runtime data.)
- Events: `UNLOCK{role}`, `STUDENT_COMPLETE`, `INTERACTION_DONE{degraded}`, `GLOBAL`,
  `FORCE_ADVANCE` (assistant override — on the wire + audited via TraceSink).
- Guard evaluator: `(ctx) => boolean`, `ctx = { state, stage, now, events }` (struct → additive).
- Advance via `nextStageId(state)` indirection (not `index++` → branching stays open).

## Conditions — composable + scoped

```
StudentPredicate : stageStatus{is} | minInteractions{count} | outputSet{output:OutputKey} | variantSelected
AdvanceCondition : immediate | allStudents{of} | countStudents{min,of} | all{[…]} | any{[…]}
```

Composition expresses Lesson 1's compound gates; per-student predicates are wrapped by class
aggregates; `outputSet` is over **config-declared** output keys (not a hardcoded `keyof`).

## Per-student variants (A/B) — generic

`StageConfig.variants: [{ id, interaction, writesOutputs }]` + persisted
`StudentRuntimeState.selectedVariant[stageId]`. Shape's drawing/dialogue is config, not a
special case (resolves the old C1 gap).

## Runtime state (typed engine fields vs config outputs)

`StudentRuntimeState = { stageStatus, interactionCounts, completedInteractionIds,
selectedVariant, pending, outputs: Record<OutputKey, RuntimeValue>, displayName?, memories,
pendingMemory, prepared }` (the last four added in contracts-v1.4 for talent memory + birth
pre-generation). Engine fields are typed; lesson **outputs are opaque** → new lesson outputs
never force a contract change.

## Persistence / resume

`ClassSession` persists `currentStageId` (string) + `lessonConfigVersion` + `global` +
`students` (full runtime state). `RESUME_STATE` carries `currentStageId`, `global`,
`lessonConfigVersion`, and the student's full `StudentRuntimeState` — enough to restore the
client without inventing state. Resume fails closed on version mismatch
(`RESUME_VERSION_MISMATCH`). No index-based cursor (CMS may reorder stages).

## Privacy at the wire

`STAGE_COMPLETE` is a **typed union carrying refs** (`AudioRef`/`DoodleRef`/…), never raw
bytes/`unknown` — no raw child audio crosses the boundary (data-and-privacy contract).

## Config validation (runtime twin of `tsc`)

A Zod validator runs on every load (git/CMS). Rejects (fail closed): unknown condition/
interaction `type`; `outputSet`/`writesOutputs`/`output` referencing an id not in the
lesson's `declared*`; duplicate `stageId`; advance/jump target not found; unreachable stage;
session `currentStageId` not in the lesson or `lessonConfigVersion` mismatch.

## Unlock framework

`unlockPolicy: "classWide"` (only one implemented; field kept for forward-compat).
`FORCE_ADVANCE` prevents a straggler freezing the class (audited).

## Out of scope (additive on this schema)

Stage graph/branching · per-group unlock resolver · timed auto-advance · stage skip/replay.
