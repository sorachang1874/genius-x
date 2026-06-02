# Contract: Course Engine (stage state machine + classroom sync)

> Owner: **Agent C** (`apps/server`). Boundary contract — frozen at the interface level
> before fan-out; internal design via per-task design note (docs/agents). Types:
> `@genius-x/contracts` (ws-events, enums, student). Built on XState + Socket.IO.

## Purpose

Drive one class through the lesson stage sequence and keep that state in sync across student
iPads, the assistant, and the teacher screen. The server holds **authoritative** state.

## Stage machine (PRD §4.1)

`standby → intro → icebreak → shape → talent → birth → closure`

| Stage | Unlock by | Advance condition |
| --- | --- | --- |
| intro | teacher | assistant unlock |
| icebreak | assistant | assistant unlock |
| shape | assistant | child selects avatar + assistant confirm |
| talent | assistant | min interactions reached + assistant unlock |
| birth | assistant | all children done |
| closure | teacher | — |

## Public interface

**WebSocket** (Socket.IO; message types in `@genius-x/contracts` ws-events):
- Inbound `ClientMessage`: `HELLO`, `ASSISTANT_UNLOCK`, `STAGE_COMPLETE`, `REQUEST_PROJECTION`
- Outbound `ServerMessage`: `STAGE_UNLOCK`, `GLOBAL_STATE`, `AI_READY`, `RESUME_STATE`

**HTTP** (typed via contracts):
- `POST /session/join` → `{ studentId, sessionId }` (room-code/QR; no password — see client-server)
- `GET /session/:id/state` → current `ClassSession` projection (read model; fail closed if absent)

## Consumes / Produces

- **Consumes:** `@genius-x/course-config` (`lesson001`), `@genius-x/ai-gateway` (all AI),
  `@genius-x/config` (mode), Redis (live `ClassSession`), Postgres (archive profiles/artifacts).
- **Produces:** `ServerMessage` events; persisted `StudentProfile` + `Artifact`; AI calls to
  the gateway. **Never calls a provider directly.**

## SLOs

| Metric | Target |
| --- | --- |
| WS state sync (unlock → student render) | ≤ 500 ms |
| Concurrent students | ≥ 15 |
| Crashes during class | 0 |
| Persistence | profile/artifact written after each AI interaction |
| Reconnect/resume | refreshed iPad resumes to current stage |

## Acceptance criteria (testable on the harness)

- Only legal transitions occur; illegal ones return `STAGE_TRANSITION_DENIED` (logged, not shown).
- `ASSISTANT_UNLOCK` propagates `STAGE_UNLOCK` to all class students ≤ 500 ms.
- After an iPad refresh, `HELLO` → `RESUME_STATE` restores the current stage + global state.
- The machine advances **regardless of AI success** (gateway returns a fallback; class proceeds).
- A simulated crash mid-class recovers current stage from persisted session state.

## Failure mode

**Primary path.** Reducers/command-owner generate downstream transitions — workers do not
self-advance stages. Read models fail closed (return explicit readiness), never repair state.
