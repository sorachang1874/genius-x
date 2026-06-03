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
      thinking.tsx        # "AI is thinking" animation (no blank wait; no AI/LLM wording)
    student/
      StudentApp.tsx      # routes by currentStageId
      stages/Standby.tsx Intro.tsx Icebreak.tsx Shape.tsx
    assistant/
      AssistantApp.tsx    # current stage + unlock controls
```

## Client ↔ server (contracts, no local redefs)

- Join: `POST /session/join {roomCode}` → `{studentId, sessionId, role}`; open WS (auth:
  {sessionId, studentId}); send `HELLO` → render `RESUME_STATE.you`/currentStageId.
- Student inputs: icebreak → `INTERACT{voice, audioRef}`; shape doodle → `INTERACT{doodle, doodleRef}`;
  pick candidate → `STAGE_COMPLETE{selection, output:"avatarUrl", value}`.
- Receives: `STAGE_UNLOCK` (advance view), `AI_OUTPUT` (render per stage), `GLOBAL_STATE`, `RESUME_STATE`.
- Assistant: `ASSISTANT_UNLOCK` / `TEACHER_UNLOCK` / `FORCE_ADVANCE`.

## Rendering ports (swap-ready — the C abstraction)

- **`ai-output.ts`**: given `ClientAiOutput`, **play `audioUrl` if present, else speak `text`
  via Web Speech API**; return `imageUrls` for the stage to render. → when real TTS/image land
  (DF-1/M6) the client is unchanged (placeholders are server-side).
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

- `socket.ts` + `session.tsx` reducer logic: unit tests with a fake socket (assert it sends the
  right `ClientMessage` and reacts to `ServerMessage`).
- Stage components: @testing-library/react (renders per stage; mic/doodle dispatch the right INTERACT).
- `ai-output.ts`: prefers audioUrl, falls back to speak(text); stub SpeechSynthesis.
- Playwright end-to-end against the running server = later.

## Deferrals (added to docs/DEFERRED.md)

DF-M3-1 TTS via SpeechSynthesis · DF-M3-2 mic placeholder audioRef · DF-M3-3 bundled candidate
images · DF-M3-4 role via query param · DF-M3-5 no PWA SW. Each with its replace trigger.

## Open decisions to confirm

1. Canvas: a minimal `<canvas>` freehand (no library) for the doodle — OK for M3?
2. Bundled placeholder avatars: a few cute preset PNGs in `public/` — acceptable stand-in?
3. Visual style: plain/functional for M3 (B-level polish later) — confirm.

## Out of scope (M4+)

Talent stage + memory, birth certificate + AI_READY/playPrepared, teacher projection, PWA
offline, real providers, parent H5.
