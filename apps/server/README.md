# @genius-x/server

Backend: the **course state machine**, **WebSocket classroom sync**, and the HTTP API.

> Agent owner: **Agent C (course runtime)**. Contracts: `docs/contracts/course-engine.md`,
> and WebSocket events in `@genius-x/contracts`.

## Responsibilities (see PRD §4, §8)

- Drive the stage state machine: standby → intro → icebreak → shape → talent → birth → closure.
- Stage unlocks come from the assistant (and teacher for global states) over WebSocket.
- Persist student profiles + artifacts after each interaction (durability — no data loss).
- Reconnect / resume: a refreshed iPad recovers to the current stage.

## Boundaries

- **Never call an AI provider directly** — go through `@genius-x/ai-gateway`.
- The state machine advances independently of AI success (AI failure must not stall class).
- Framework (Fastify recommended for TS + WebSocket; confirm before installing).
- Datastore (PostgreSQL + Redis per PRD) to be wired in a later phase.
