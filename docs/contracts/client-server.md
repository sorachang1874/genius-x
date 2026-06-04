# Contract: Client ↔ Server

> Owners: **Agent A/B** (`apps/web`) ↔ **Agent C** (`apps/server`). Boundary contract — the
> wire protocol between the iPad clients and the server. Types: `@genius-x/contracts`
> (ws-events). Reuse: Socket.IO client + vite-plugin-pwa.

## Purpose

Define exactly how student/assistant clients talk to the server so the two sides cannot
drift. The client is a thin view of the server's authoritative state.

## Public interface

**Connection lifecycle:**
1. Client joins: `POST /session/join` (room-code/QR) → `{ studentId, sessionId }`.
2. Client opens WS, sends `HELLO { studentId }`.
3. Server replies `RESUME_STATE { currentStage, global }` → client renders that stage.
4. Steady state: client sends `INTERACT` (interaction input — incl. `playPrepared` to replay a
   pre-generated output) / `STAGE_COMPLETE` (choice/finish) / (assistant) `ASSISTANT_UNLOCK` /
   `REQUEST_PROJECTION{requestedBy}`; server pushes `STAGE_UNLOCK` / `GLOBAL_STATE` / `AI_OUTPUT`
   (per-student renderable result) / `AI_READY{preparedId,outputKind}` (a pre-generated output is
   ready to play — the play button is gated on this) / `PROJECT`.

**Reconnect:** exponential backoff (max 5); on reconnect re-send `HELLO` → `RESUME_STATE`
(PRD §8.2). The client never invents stage state — it always reconciles to the server.

## Consumes / Produces

- **Client consumes:** `ServerMessage`; renders per stage. **Produces:** `ClientMessage`.
- **Server consumes:** `ClientMessage`. **Produces:** `ServerMessage` (see course-engine).

## SLOs

| Metric | Target |
| --- | --- |
| Unlock → student screen update | ≤ 500 ms |
| Reconnect attempts | ≤ 5 (exponential backoff) |
| Offline resilience | app shell + lesson config + fallback library precached |

## Acceptance criteria (testable on the harness)

- Assistant `ASSISTANT_UNLOCK` updates all class student screens ≤ 500 ms.
- iPad refresh mid-stage → client resumes to the correct stage via `RESUME_STATE`.
- With the network dropped, the precached UI stays alive (no blank screen); writes queue and
  replay on reconnect.
- **No "Prompt/LLM/AI/token" wording and no failure/error state ever shown to the child** —
  any error maps to a positive fallback view (PRD §0).

## Failure mode

**Primary.** Auth is lightweight (room-code/QR) and does NOT depend on Better Auth being up
(shadow). Latency dressed as "thinking" animation, never a blank wait.

> Role note (v1.2): `ASSISTANT_UNLOCK` / `TEACHER_UNLOCK` carry the intended role, but the
> server currently derives role from the **message type, not the connection identity**
> (trusted-classroom MVP). When auth lands, the server must verify the connection's role
> matches the message before honoring teacher/assistant unlocks.
