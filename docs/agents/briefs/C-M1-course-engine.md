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

- `packages/contracts/**` and `docs/contracts/**` — FROZEN (read-only). The only allowed
  change is **LEAD-A1** (session join types), done by the lead, not in this branch.
- `apps/web/**`, `packages/ai-gateway/**`, shadow systems.

## Frozen contracts to import (read-only)

- `@genius-x/contracts`: `StageId`, `UnlockBy`, `ServerMessage`, `ClientMessage`,
  `ClassSession`, `StudentSessionState`, `ErrorCode`, (after LEAD-A1) session join types.
- `@genius-x/course-config`: `lesson001`.
- `@genius-x/config`: `loadConfig`.

## Context to read first

- `AGENTS.md`, `docs/agents/README.md`
- `docs/contracts/course-engine.md`, `docs/contracts/client-server.md`
- `docs/architecture/interaction-map.md` (Flows 1, 6, reconnect)
- `docs/product/genius-x-lesson1-rundown.md`

## Implementation notes

- State machine: **XState v5**. States = the 7 stages; events = unlock/complete; guards from
  per-student `stageStatus`. Pure, unit-testable, persistable.
- Sync: **Socket.IO**, one room per class session. Server holds authoritative state; clients
  are views. Resume = `HELLO` → `RESUME_STATE`.
- Persistence: Redis for live `ClassSession`; recover current stage on reconnect/crash.

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
