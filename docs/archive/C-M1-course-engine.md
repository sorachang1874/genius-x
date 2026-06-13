# Task Brief: C-M1 — Course Engine (state machine + sync + resume)

> Owner agent: **C** · Coding agent: **Claude Code** · Branch: `c-m1-course-engine`

## Goal

`apps/server` drives one class through the lesson stages (from `lesson001`) and keeps all
clients in sync over Socket.IO, with reconnect/resume from authoritative server state.
**No AI calls in M1.**

## Non-goals

- No AI/provider/gateway calls (M2/M3). Stages that involve AI just advance on completion events.
- No frontend (`apps/web`). No shadow systems. No image/voice handling.

## Owned paths

- `apps/server/src/engine` (XState machine), `apps/server/src/sync` (Socket.IO),
  `apps/server/src/session` (state + persistence), `apps/server/test` (M1 smoke is E's).

## Do-not-touch

- `packages/contracts/**` and `docs/contracts/**` — FROZEN at `contracts-v1.1` (read-only).
  A contract change goes through the lead + independent review, never in this branch.
- `apps/web/**`, `packages/ai-gateway/**`, shadow systems.

## Frozen contracts to import (read-only — `contracts-v1.1`)

- `@genius-x/contracts`: `EngineEvent`, `EngineCommand`, `EngineResult`; `LessonConfig`,
  `AdvanceCondition`, `StudentPredicate`; `ClassSession`, `StudentRuntimeState`;
  `ServerMessage`, `ClientMessage`, `StageCompletePayload`; `SessionJoinRequest/Response`;
  `ErrorCode`.
- `@genius-x/course-config`: `lesson001`.
- `@genius-x/config`: `loadConfig`.

## Context to read first

- `AGENTS.md`, `docs/agents/README.md`
- `docs/contracts/course-engine.md`, `docs/contracts/client-server.md`
- `docs/architecture/interaction-map.md` (Flows 1, 6, reconnect)
- `docs/product/genius-x-lesson1-rundown.md`

## Implementation notes

- Engine: **generic pure reducer** over `lesson001` (NOT XState) — see the design note +
  `docs/architecture/lesson-runtime.md`. Guard registry + Zod config validator.
- Sync: **Socket.IO**, one room per session; map `ClientMessage`↔`EngineEvent`, execute
  `EngineCommand`s. Resume = `HELLO` → `RESUME_STATE` (full per-student state + version).
- Persistence: Redis for live `ClassSession` (in-memory in local/scripted); recover on
  reconnect/crash; fail closed on `RESUME_VERSION_MISMATCH`.

## Design note (submit BEFORE coding — lead reviews & approves)

See `docs/agents/designs/C-M1-course-engine.md` (lead-drafted for this cycle). Coding starts
only after founder/lead approves it.

## Validation (Definition of Done)

```sh
pnpm typecheck            # contract preflight + types
pnpm --filter @genius-x/server test   # C-M1a machine unit tests
# E-M1 scripted smoke: session walks all stages, asserts unlock ≤500ms + resume
```

No `--no-verify`, no `as any`, no `.skip()`, no no-op stubs.

## Stop conditions (ask the lead)

- A contract change beyond LEAD-A1 is needed.
- Per-assistant-group unlock vs class-wide unlock needs a product call (see design note).

## Handoff (fill on completion)

- What changed · What was validated · What failed/not run · Files touched · Residual risk · Next step
