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

## Next: M3 — Frontend (`apps/web`) — IN PROGRESS on branch `m3-frontend`

Design note `docs/agents/designs/A-M3-frontend.md` is written + Codex-reviewed (hardened).

**Done (branch `m3-frontend`):** scaffolding — Vite+React+TS app builds, `pnpm typecheck`
green across all 6 packages. `App.tsx` role entry (`?role=assistant`); student/assistant stubs.

**Remaining M3 (do next):** `shared/socket.ts` (typed Socket.IO client over `@genius-x/contracts`)
→ `shared/session.tsx` (React context: currentStageId/global/my StudentRuntimeState/last AI
output, rendered from `RESUME_STATE.you`) → `shared/ai-output.ts` (play audioUrl-or-speak text;
imageUrls) + `voice.ts` (mic→placeholder audioRef) → student stages standby/intro/icebreak/shape
(A-line) → assistant unlock panel → component+socket unit tests (incl. banned-wording scan) →
PR → Codex review → merge. Follow A-M3 design note exactly; consumes `@genius-x/contracts` (no redefs).

> esbuild build-script: if `pnpm test`/`dev` errors on a missing esbuild binary, run
> `pnpm approve-builds` and select esbuild (typecheck already works).

Then M4 (talent/birth/memory + AI_READY{preparedId,outputKind} + playPrepared) → wire-up = B-level demo.

## Open / deferred

- Memory extraction not yet wired into talent (gateway has `extractMemory`) — M4.
- Birth pre-generation + `playPrepared` + `AI_READY` payload — M4 (deferred in M2b).
- Real Tencent providers + 天御 moderation — M6 (inject behind the existing seams; config/key swap).
- `REQUEST_PROJECTION` → teacher big-screen delivery — later.
- In-process session mutex = single-instance only (multi-instance → Redis lock).
- China: author offshore, run in China; demo uses fakes.

## Handoff — next session starts here (M3 features, on branch `m3-frontend`)

1. `git checkout m3-frontend` (scaffolding already here, green).
2. Read: `docs/agents/designs/A-M3-frontend.md` (the plan), `AGENTS.md`,
   `docs/agents/README.md` + `REVIEW_BRIEF.md`, `docs/contracts/` (client-server, course-engine),
   `packages/contracts/src/ws-events.ts` (the messages to consume), `docs/DEFERRED.md`.
3. `pnpm install && pnpm typecheck` (green). `pnpm approve-builds` → esbuild if test/dev needs it.
4. Implement remaining M3 (see "Next" above): socket → session → ports → stages → assistant →
   tests → PR → Codex review (xhigh, `< /dev/null`) → merge. Then M4.
