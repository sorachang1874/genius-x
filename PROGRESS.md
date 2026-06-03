# PROGRESS

## Last updated

2026-06-04

## Current state

**M2 complete.** The backend runs Lesson 1 end-to-end AND produces AI content (on fake
providers). Merged PRs #1-#5, all cross-model (Claude+Codex) reviewed to GO. main is green.

- M1 — generic config-driven reducer + guards + Zod validator + Socket.IO sync + atomic
  session store + resume.
- E-M1 — real-socket end-to-end smoke (intro→closure + reconnect).
- M2a — AI gateway core: `llm/tts/asr/imageGen/extractMemory`, pipeline (input safety →
  timeout-bounded provider → output validation+safety → fallback, never throws), fake
  provider with fault injection, moderation seam (real 天御 IMS = M6).
- M2b — contracts-v1.3 (`INTERACT`/`AI_OUTPUT`/`ClientAiOutput`/`PROJECT`/`pending`;
  `STAGE_COMPLETE`=selection/variantChoice/done) + interaction wiring: INTERACT →
  CALL_INTERACTION → gateway → AI_OUTPUT → INTERACTION_DONE, idempotent, stale-safe,
  run outside the session mutex.

Tests: ai-gateway 19/19, server 47/47, typecheck green across packages. Contracts at v1.3
(tags contracts-v0/v1/v1.1; v1.2 TEACHER_UNLOCK; v1.3 interactions — not separately tagged).

## Codex review setup (operational — IMPORTANT)

`codex exec` reviews MUST be run as: `codex exec --sandbox read-only -c
model_reasoning_effort="xhigh" "<prompt starting with docs/agents/REVIEW_BRIEF.md>" < /dev/null
> file 2>&1` — the `< /dev/null` is critical (without it codex blocks on stdin and "hangs").
For fast confirmations, tell codex "do NOT run any shell commands, just read + verdict"
(~48s vs timing out). Never pipe through `tail`. See docs/agents/README.md.

## Next: M3 — Frontend (`apps/web`) — FEATURES BUILT on branch `m3-frontend` (pending Codex review + merge)

Design note `docs/agents/designs/A-M3-frontend.md` (Codex-reviewed/hardened) implemented.

**Done (branch `m3-frontend`):**
- `shared/socket.ts` — typed `ClassroomSocket` over `@genius-x/contracts` (send `ClientMessage`,
  recv `ServerMessage`), socket.io-client reconnect (5 attempts), `joinSession` POST,
  `fetchSessionState` GET (assistant's read-only stage bootstrap), `serverBaseUrl` (VITE_SERVER_URL).
- `shared/session.tsx` — React context + reducer. Student: POST join → WS → **HELLO on every
  (re)connect → render from `RESUME_STATE.you`** (incl. `you.outputs.avatarUrl`), `lessonConfigVersion`
  stored. Assistant: joins on room code only, **never sends HELLO** (would register a phantom student
  & skew class-wide gates); learns stage from GET + STAGE_UNLOCK. Optimistic selection. Injectable
  socket/join/fetch seams for tests.
- `shared/ai-output.ts` — play `audioUrl` else speak `text` (Web Speech); audio error → silent
  speech fallback (no child-facing error); exposes `imageUrls`.
- `shared/voice.ts` — `getUserMedia`/MediaRecorder UX → **placeholder `audioRef`** (DF-M3-2);
  mic-denied degrades gracefully (still returns a ref, INTERACT still sent).
- `shared/thinking.tsx` — child-safe "magic" pending animation (no AI/Prompt/LLM wording).
- Student stages: `Standby`/`Intro`/`Icebreak` (hold-to-talk voice) / `Shape` (A-line native-canvas
  doodle → 变身 → 3 candidates → select → avatar). `StudentApp` = room-code join + stage router.
- `AssistantApp` — reads `lesson001` stage order/unlock-role from `@genius-x/course-config`
  (no hardcoded stage ids); unlocks next via `ASSISTANT_UNLOCK`/`TEACHER_UNLOCK`. `FORCE_ADVANCE`
  deferred (DF-M3-8: needs assistants registered on join).
- Tests: **apps/web 29/29** (fake-socket session incl. reconnect+resume & exact `ClientMessage`
  shapes; ai-output audio→speech fallback; voice degrade; stage render+dispatch+thinking;
  banned-wording scan). Full suite green: ai-gateway 19, server 47, web 29. typecheck green;
  `vite build` OK. New deferrals: **DF-M3-8** (assistant FORCE_ADVANCE) + DF-M3-2 extended (doodleRef).

**Remaining M3:** Codex review (xhigh, `< /dev/null`) → address → human merge to main.

Then M4 (talent/birth/memory + AI_READY{preparedId,outputKind} + playPrepared) → wire-up = B-level demo.

## Open / deferred

- Memory extraction not yet wired into talent (gateway has `extractMemory`) — M4.
- Birth pre-generation + `playPrepared` + `AI_READY` payload — M4 (deferred in M2b).
- Real Tencent providers + 天御 moderation — M6 (inject behind the existing seams; config/key swap).
- `REQUEST_PROJECTION` → teacher big-screen delivery — later.
- In-process session mutex = single-instance only (multi-instance → Redis lock).
- China: author offshore, run in China; demo uses fakes.

## Handoff — next session starts here (M3 review/merge, on branch `m3-frontend`)

1. `git checkout m3-frontend` (M3 features built + green; PR open).
2. Read: `docs/agents/designs/A-M3-frontend.md`, `AGENTS.md`, `docs/agents/README.md` +
   `REVIEW_BRIEF.md`, `packages/contracts/src/ws-events.ts`, `docs/DEFERRED.md` (DF-M3-1..8).
3. `pnpm install && pnpm typecheck && pnpm test` (all green: ai-gateway 19 / server 47 / web 29).
4. Address Codex review findings on the PR → human merges to main. Then M4 (talent/birth/memory +
   `AI_READY{preparedId,outputKind}`/`playPrepared` + projection wire-up).
