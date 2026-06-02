# Design Note: C-M1 — Course Engine (generic reducer)

> Status: **revised for contracts-v1.1** (GO). Engine model lives in
> `docs/architecture/lesson-runtime.md`; this note is the M1 build plan. No code until the
> lead/founder approves. Owner: Agent C.

## Scope

M1 = the **generic lesson reducer** + Socket.IO sync + persistence/resume, driven by
`lesson001` as instance #1. **No AI in M1**: stages that will use AI advance on
`STUDENT_COMPLETE` / `INTERACTION_DONE` events; the gateway is wired in M2/M3.

## Build

1. **Reducer** `(state: ClassSession, EngineEvent) => EngineResult` (pure; types from
   `@genius-x/contracts` engine.ts). Advance via `nextStageId` + the guard registry; emits
   `EngineCommand[]` (`BROADCAST`/`CALL_INTERACTION`/`PERSIST`/`TRACE`) — no effects inside.
2. **Guard registry**: `AdvanceCondition.type → evaluator(ctx)`; `StudentPredicate` evaluators
   (`stageStatus`/`minInteractions`/`outputSet`/`variantSelected`). Exhaustive (`never`) so a
   new condition type forces every site to update.
3. **Zod config validator** (runtime twin of `tsc`): validates a `LessonConfig` on load
   against the schema + its `declared*` ids (unknown type / dangling output / dup stageId /
   unreachable stage → fail closed). Reused by git load now, CMS later.
4. **Socket.IO sync**: map `ClientMessage → EngineEvent`; execute `EngineCommand`s; one room
   per session. `HELLO → RESUME_STATE` (full `StudentRuntimeState` + `lessonConfigVersion`).
5. **Persistence**: `ClassSession` write-through to Redis (in-memory in local/scripted mode);
   recover on reconnect/crash; resume fails closed on `RESUME_VERSION_MISMATCH`.

## Module layout (`apps/server/src`)

```
engine/reducer.ts      pure reducer (EngineEvent → EngineResult)
engine/guards.ts       condition + predicate evaluator registry
engine/validate.ts     Zod LessonConfig validator
engine/nextStage.ts    next-stage resolver (no index++)
sync/socket.ts         Socket.IO server + rooms; ClientMessage↔EngineEvent; command executor
session/store.ts       ClassSession store (Redis | in-memory by mode)
http.ts                Fastify: POST /session/join (SessionJoinRequest/Response), GET /session/:id/state
index.ts               bootstrap: loadConfig → validate(lesson001) → store → reducer → server
```

**Libs to add at coding time (for approval):** `socket.io`, `fastify`, `ioredis`, `zod`, `vitest`.
(No XState — the engine is a reducer over runtime config.)

## Acceptance (E-M1 verifies on fake events)

unlock→all students ≤500ms · illegal transition → `STAGE_TRANSITION_DENIED` (logged) ·
refresh→`RESUME_STATE` restores full per-student state · `FORCE_ADVANCE` overrides a guard
(audited) · advance independent of AI · crash→recover from persisted `ClassSession` ·
invalid config → fail closed at load.

## Open product point (carried)

Class-wide unlock (v1) — per-assistant-group is a later `unlockPolicy`. Straggler handled by
`FORCE_ADVANCE`.
