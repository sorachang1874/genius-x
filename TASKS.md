# TASKS — current cycle: M1 (course engine)

Read-only during agent work. Boundary contracts: `docs/contracts/course-engine.md`,
`client-server.md`. Protocol: `docs/agents/README.md`. Each coding task starts with a
**design note** that the lead approves **before** any code (Layer-2 gate).

## Cycle goal

Generic reducer engine + Socket.IO classroom sync + reconnect/resume, driven by `lesson001`.
**No AI in M1** — stages advance on unlock/complete events; gateway calls come in M2/M3.

## Tasks

| ID | Task | Owner | Paths | Depends on | Parallel-safe |
| --- | --- | --- | --- | --- | --- |
| LEAD-A1 | ✅ DONE — folded into **contracts-v1** (session join types added; full generic engine contract applied + tagged) | Lead/E | `packages/contracts` | — | done |
| C-M1a | Generic reducer (`EngineEvent`→`EngineResult`) + guard registry + Zod config validator, consumes `lesson001` | C | `apps/server/src/engine` | contracts-v1.1 | yes |
| C-M1b | Socket.IO sync + authoritative session state (HELLO/RESUME_STATE, ASSISTANT_UNLOCK→STAGE_UNLOCK, STAGE_COMPLETE, GLOBAL_STATE) | C | `apps/server/src/sync`, `.../session` | C-M1a, LEAD-A1 | no |
| C-M1c | Reconnect/resume + Redis session persistence + crash recovery | C | `apps/server/src/session` | C-M1b | no |
| E-M1 | M1 smoke: drive a session through all stages (no AI), assert SLO/acceptance (unlock ≤500ms, resume, no illegal transition) | E | `apps/server/test` (or harness) | C-M1b | after C-M1b |

## Sequencing

`LEAD-A1` (tiny, first) → `C-M1a` (can start in parallel with A1) → `C-M1b` → `C-M1c`;
`E-M1` after `C-M1b`. M1 is largely single-owner (C); limited parallelism — that's expected.

## Do-not-touch this cycle

`packages/contracts` is frozen except the lead-owned `LEAD-A1` amendment. No edits to
`apps/web`, `packages/ai-gateway`, shadow systems. No AI/provider calls in M1.

## Definition of Done (per task)

Design note approved → code → CI green (typecheck/preflight, + unit for C-M1a, + E-M1 smoke)
→ PR → human merge. No `--no-verify` / `as any` / `.skip()` / no-op stubs.
