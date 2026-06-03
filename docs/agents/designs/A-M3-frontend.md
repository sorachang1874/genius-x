# Design Note: A-M3 — Frontend (student stages 1-2 + assistant panel)

> Status: **proposed, pending review** (Layer-2 gate). Owners: Agent B (student), Agent A
> (assistant). Consumes `@genius-x/contracts` read-only. Functional-first (A-level), then
> iterate to B-level polish. Deferrals tracked in `docs/DEFERRED.md` (DF-M3-*).

## Goal / scope (M3)

A real `apps/web` that runs the **student** through Lesson 1 **stages 1-2** (intro → icebreak
voice → shape A-line doodle→image→select) and an **assistant** panel that unlocks stages —
all synced over Socket.IO, AI content from the fake gateway. Talent/birth + projection = M4.

## Stack (per build-vs-reuse)

Vite + React + TypeScript; `socket.io-client`; React Context for session state (no Redux —
overkill). Tests: Vitest + @testing-library/react + a fake socket. **No PWA service worker
yet** (DF-M3-5). One app, role-separated internally (`src/student`, `src/assistant`, `src/shared`).

## Directory

```
apps/web/
  index.html  vite.config.ts  tsconfig.json
  public/                 # placeholder assets: clay figure, 3 preset candidate avatars (DF-M3-3)
  src/
    main.tsx  App.tsx     # role entry (?role=assistant | student), room-code join
    shared/
      socket.ts           # typed Socket.IO client over @genius-x/contracts (send ClientMessage / on ServerMessage)
      session.tsx         # React context: currentStageId, global, my StudentRuntimeState, last AI output
      ai-output.ts        # ClientAiOutput renderer port: play audioUrl-or-speak(text) via SpeechSynthesis; expose imageUrls
      voice.ts            # VoiceCapture port: MediaRecorder UX → INTERACT(voice, placeholder audioRef) (DF-M3-2)
      thinking.tsx        # "magic is happening" animation — child-safe copy ONLY (e.g. 魔法在变身中…), NEVER AI/LLM/Prompt wording
    student/
      StudentApp.tsx      # routes by currentStageId
      stages/Standby.tsx Intro.tsx Icebreak.tsx Shape.tsx
    assistant/
      AssistantApp.tsx    # current stage + unlock controls
```

## Client ↔ server (contracts, no local redefs)

All emits are built with `satisfies ClientMessage` (full required fields). Examples:
```ts
const id = crypto.randomUUID();
sock.emit("client_message", { type: "INTERACT", studentId, stageId, interactionId: id, input: { kind: "voice", audioRef } } satisfies ClientMessage);
sock.emit("client_message", { type: "INTERACT", studentId, stageId, interactionId: id, input: { kind: "doodle", doodleRef } } satisfies ClientMessage);
sock.emit("client_message", { type: "STAGE_COMPLETE", studentId, stageId, payload: { kind: "selection", output: "avatarUrl", value } } satisfies ClientMessage);
// assistant (demo assistantId from join/role, e.g. "assistant-1"):
sock.emit("client_message", { type: "ASSISTANT_UNLOCK", stageId, assistantId } satisfies ClientMessage);
```
- Join: `POST /session/join {roomCode}` → `SessionJoinResponse`; open WS (auth `{sessionId, studentId}`).
- Receives `ServerMessage`: `STAGE_UNLOCK` (advance view), `AI_OUTPUT` (render per stage),
  `GLOBAL_STATE`, `RESUME_STATE`. (`AI_READY`/`PROJECT` consumed in M4.)

## Reconnect + resume (client-server.md)

- socket.io-client `reconnection: true`, exponential backoff, max 5 attempts.
- On every (re)connect send `HELLO`; the server replies `RESUME_STATE`. **The client renders
  from `RESUME_STATE.you` (the authoritative `StudentRuntimeState`)** — `currentStageId`,
  `global`, and `you.outputs` (e.g. `avatarUrl`) — NOT from locally-held AI output. Store
  `lessonConfigVersion`; the server fails closed on mismatch (we just show "thinking" + retry).
- **Candidate images (pre-selection) are transient** and not persisted: a refresh mid-`shape`
  before selecting re-shows the doodle step (re-trigger `INTERACT`). After selection,
  `outputs.avatarUrl` restores the chosen avatar. Documented so it's not a surprise.

## Rendering ports (swap-ready — the C abstraction)

- **`ai-output.ts`**: given `ClientAiOutput`, **play `audioUrl` if present, else speak `text`
  via Web Speech API**; return `imageUrls` for the stage to render. → when real TTS/image land
  (DF-1/M6) the client is unchanged (placeholders are server-side). **Non-failure path:** the
  server omits `audioUrl` unless playable; on any audio load/play error the renderer silently
  falls back to `speak(text)` — the child never sees an error (PRD §0).
- **`voice.ts`**: real `MediaRecorder` UX; emits a placeholder `audioRef` for now (DF-M3-2).

## Stage UX (hard rules: no AI/Prompt/LLM wording; every input → positive output; latency = "thinking")

- **Standby/Intro**: white clay "魔法泥人" + copy; start locked until `STAGE_UNLOCK`.
- **Icebreak**: hold-to-talk mic → thinking → play AI reply (audio-or-spoken). Repeat.
- **Shape (A-line)**: canvas doodle → "变身" → thinking (8-15s copy) → 3 candidate images →
  select → avatar becomes the child's. (B-line dialogue = later; lesson-001 ships A-line.)

## Role entry

`App.tsx`: `?role=assistant` → AssistantApp; else student join screen (room code). Real RBAC =
Better Auth (DF-8). Documented as a demo convenience (DF-M3-4).

## Testing

- `socket.ts` + `session.tsx`: fake socket — assert **exact** `ClientMessage` shapes emitted,
  and that `ServerMessage`s drive state; **reconnect+resume** (HELLO → render from
  `RESUME_STATE.you` incl. `you.outputs.avatarUrl`); `lessonConfigVersion` stored.
- Stage components (@testing-library/react, jsdom): renders per stage; mic/doodle dispatch the
  right `INTERACT`; the "thinking" pending state shows during an in-flight interaction.
- `ai-output.ts`: prefers `audioUrl`; on stubbed audio error falls back to `speak(text)` (no error UI).
- `voice.ts`: mic-denied / unavailable degrades gracefully (still sends INTERACT, no failure).
- **Banned-wording scan**: a test asserts no rendered child-facing string contains
  `AI/Prompt/LLM/token/model` (enforces the hard rule).
- Playwright end-to-end against the running server = later.

## Deferrals (added to docs/DEFERRED.md)

DF-M3-1 TTS via SpeechSynthesis · DF-M3-2 mic placeholder audioRef · DF-M3-3 bundled candidate
images · DF-M3-4 role via query param · DF-M3-5 no PWA SW. Each with its replace trigger.

## Confirmed — but INTERIM (current state only; full design later)

These are accepted **for M3 functional-first**, and are explicitly the current state pending a
**full UX + visual design pass** (tracked as DF-M3-6/DF-M3-7):
1. Doodle = minimal native `<canvas>` freehand (no library).
2. Candidate avatars = a few preset placeholder PNGs in `public/`.
3. Visual style = plain/functional; B-level polish later.

## Out of scope (M4+)

Talent stage + memory, birth certificate + AI_READY/playPrepared, teacher projection, PWA
offline, real providers, parent H5.
