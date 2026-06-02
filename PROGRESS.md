# PROGRESS

## Last updated

2026-06-03

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

## Next: M3 — Frontend (`apps/web`) — the largest remaining gap to a demo

Per `docs/architecture/build-vs-reuse.md`: Vite + React PWA. Owners A (assistant) / B (student).

1. Start with a design note `docs/agents/designs/A-M3-frontend.md` (Vite+React PWA setup;
   Socket.IO client; student stages 1-2 = voice icebreak + shape image-gen A-line; assistant
   unlock panel; render `AI_OUTPUT`/`RESUME_STATE`/`STAGE_UNLOCK`). → Codex review → branch.
2. The client consumes `@genius-x/contracts` (ws-events) — no local type redefs.
3. Hard UI rules (REVIEW_BRIEF): no "Prompt/LLM/AI" wording to the child; no failure state;
   latency dressed as "thinking".

Then M4 (talent/birth/memory + AI_READY{preparedId,outputKind} + playPrepared) → wire-up = B-level demo.

## Open / deferred

- Memory extraction not yet wired into talent (gateway has `extractMemory`) — M4.
- Birth pre-generation + `playPrepared` + `AI_READY` payload — M4 (deferred in M2b).
- Real Tencent providers + 天御 moderation — M6 (inject behind the existing seams; config/key swap).
- `REQUEST_PROJECTION` → teacher big-screen delivery — later.
- In-process session mutex = single-instance only (multi-instance → Redis lock).
- China: author offshore, run in China; demo uses fakes.

## Handoff — next session starts here (M3)

1. Read: `AGENTS.md`, `docs/agents/README.md` + `REVIEW_BRIEF.md`, `docs/architecture/`
   (lesson-runtime, build-vs-reuse), `docs/contracts/` (client-server, course-engine).
2. Run: `pnpm install && pnpm typecheck && pnpm -r test` (should be green).
3. Write the A-M3 design note → Codex review → implement on a branch → PR → review → merge.
