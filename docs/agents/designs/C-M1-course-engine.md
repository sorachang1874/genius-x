# Design Note: C-M1 — Course Engine

> ⚠️ **§2 SUPERSEDED** by `docs/architecture/lesson-runtime.md` — the engine is a **generic
> config interpreter**, not a Lesson-1-hardcoded statechart. This note will be revised after
> the generic runtime + LessonConfig v1 are approved. The sync/persistence/resume parts
> (§3-§5) still stand.
>
> Status: **proposed, pending lead/founder approval** (Layer-2 gate). No code until approved.
> Against boundary contracts: `course-engine.md`, `client-server.md`. Owner: Agent C.

## Scope

M1 = stage progression + classroom sync + reconnect, driven by `lesson001`. **No AI.** Stages
that will use AI (icebreak/shape/talent/birth) advance on `STUDENT_COMPLETE` events in M1;
the AI that produces their payloads is wired in M2/M3.

## 1. State model — class-level machine + per-student status

One **class-level** authoritative machine per session (state = the class's current stage).
Per-student progress (`StudentSessionState.stageStatus`) lives in the machine **context**,
not as separate machines. This matches `ClassSession.currentStage` (contracts) and keeps one
source of truth.

> **Product decision to confirm:** MVP treats unlock as **class-wide** (an assistant unlock
> advances the whole class). The rundown has 3 assistants each owning 2-3 kids, which could
> imply per-assistant-group unlock. Recommend class-wide for MVP simplicity; per-group is a
> later refinement. **Please confirm.**

## 2. XState v5 machine

- **States:** `standby → intro → icebreak → shape → talent → birth → closure → done`.
- **Context:** `{ lesson: LessonConfig; currentStage: StageId; students: Record<string, StudentSessionState>; stageStartTime }`.
- **Events:**
  - `UNLOCK { byRole: UnlockBy; assistantId? }` — advances to the next stage if the guard passes.
  - `STUDENT_COMPLETE { studentId; stageId; data }` — updates that student's `stageStatus`/data.
  - `GLOBAL { state: "closure" | "standby" }` — teacher-driven jump (intro/closure).
- **Guards (advance conditions, PRD §4.1):** `UNLOCK` honored only if `byRole` matches the
  target stage's `unlockBy`; `shape→talent` needs the student avatar selected; `talent→birth`
  needs `minInteractions` met; `birth→closure` needs all students completed. Guards read context.
- Pure and unit-testable; serializable snapshot for persistence.

## 3. Socket.IO sync

- **Rooms:** one per session, `class:<sessionId>`. Server authoritative; clients are views.
- **Inbound → machine:** `ASSISTANT_UNLOCK`→`UNLOCK`; `STAGE_COMPLETE`→`STUDENT_COMPLETE`;
  teacher action→`GLOBAL`; `HELLO`→(join room, reply `RESUME_STATE`).
- **Outbound (on machine transition):** broadcast `STAGE_UNLOCK` / `GLOBAL_STATE` to the room;
  `AI_READY` is emitted in M4 (no-op hook in M1). SLO: unlock→broadcast ≤ 500 ms.

## 4. Session state + persistence

- Authoritative `ClassSession` held in memory, mirrored to **Redis** on every transition /
  student update (write-through). On reconnect or server restart, rebuild from Redis.
- M1 persists session state only; `StudentProfile`/`Artifact` archival to Postgres is M3/M4.
- Local/scripted mode may use an in-memory store (config-gated) so dev runs need no Redis.

## 5. Reconnect / resume (client-server.md)

Client backoff (≤5); on (re)connect emits `HELLO` → server replies `RESUME_STATE
{ currentStage, global }`. Client never invents state — always reconciles to the server.

## 6. Requires LEAD-A1 (small contracts amendment)

Add to `@genius-x/contracts` (then re-tag `contracts-v0.1`):
`SessionJoinRequest { roomCode }`, `SessionJoinResponse { studentId; sessionId; role }`.
Lead-owned; precedes C-M1b. Everything else uses frozen v0 types as-is.

## 7. Module layout (`apps/server/src`)

```
engine/machine.ts    XState machine + guards (C-M1a, unit-tested)
sync/socket.ts       Socket.IO server + room wiring (C-M1b)
sync/handlers.ts     ClientMessage → machine events; transitions → ServerMessage
session/store.ts     Redis (or in-memory) ClassSession store (C-M1c)
http.ts              Fastify: POST /session/join, GET /session/:id/state
index.ts             bootstrap: loadConfig → store → machine → server
```

**Libs to add at coding time (for approval):** `xstate`, `socket.io`, `fastify`, `ioredis`,
`@types/node`, `vitest`.

## 8. SLO / acceptance mapping (how E-M1 verifies)

- unlock→all students ≤500ms · illegal transition → `STAGE_TRANSITION_DENIED` (logged) ·
  refresh→`RESUME_STATE` restores stage · advance independent of AI · crash→recover from Redis.

## 9. Risks / alternatives

- **Class-wide vs per-group unlock** (see §1) — needs your call.
- **Redis in dev:** gated by mode so local runs need no container; prod uses Redis.
- **XState v5 persistence:** use `getPersistedSnapshot`/`createActor({snapshot})` for resume.
- AI-stage payloads (avatarUrl, memories) are passed through in M1, generated in M3.
