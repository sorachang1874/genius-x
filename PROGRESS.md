# PROGRESS

## Last updated

2026-06-03

## Current state

Planning + foundation **complete**. **contracts-v1.1 frozen (GO)** — passed cross-model
independent review (Claude + Codex/gpt-5.5). Engine = generic config-driven reducer. No
business code yet. Ready for M1 (first code).

Done:

- Scaffolding: pnpm monorepo, Python tools `.venv`, product docs in `docs/product/`.
- Playbook optimized locally (`~/projects/ai-assisted-engineering-playbook`, not pushed).
- Build-vs-reuse infra map; multi-agent collaboration protocol (`docs/agents/`) with a
  standing **independent-review gate** (Codex CLI wired: `codex exec`, gpt-5.5).
- GitHub private remote + CI (typecheck/preflight) merge gate.
- **contracts-v1.1**: generic engine contract — opaque ids, composable+scoped advance
  conditions, generic variants, typed `StudentRuntimeState`, `EngineEvent/Command/Result`,
  ref-typed `STAGE_COMPLETE` (privacy), full `ClassSession` + resume. Tags: contracts-v0,
  v1, v1.1.
- `pnpm typecheck` green across 5 packages; `lesson-001` typed = contract preflight.
- docker-compose (PG/Redis); `@genius-x/config` runtime modes; fake-provider harness skeleton.
- M1 design artifacts: `TASKS.md`, Agent C brief, C-M1 design note (generic reducer).

## Recent decisions

- D1 name in Lesson 2 · D2 both A/B lines (A primary; both now in lesson-001) · D3 provider-agnostic.
- Engine = pure generic reducer over config (not XState). Primary vs shadow path.
- Independent review gate is standing (different-model, Codex/gpt-5.5).

## Open risks

- Fake-provider simulation harness runtime + Lesson-1 smoke still to build (M2 — needs gateway).
- China: do not run Claude Code on the Tencent VPS (author offshore, run in China).

## Handoff — next agent starts here (M1, Agent C, Claude Code)

1. Read: `AGENTS.md`, `docs/agents/README.md` + `briefs/C-M1-course-engine.md` +
   `designs/C-M1-course-engine.md`, `docs/architecture/lesson-runtime.md`, `docs/contracts/`.
2. Run: `pnpm install && pnpm typecheck`; `docker compose up -d` (PG/Redis).
3. Build C-M1a (reducer + guard registry + Zod validator) on branch `c-m1-course-engine`;
   design note already approved direction — implement, PR, independent review, never auto-merge.
