# PROGRESS

## Last updated

2026-06-02

## Current state

Planning + foundation. **contracts v0 is frozen** (`contracts-v0` tag). No business logic yet.

Done:

- Scaffolding: pnpm monorepo, Python tools `.venv`, product docs in `docs/product/`.
- Playbook optimized locally (`~/projects/ai-assisted-engineering-playbook`, not pushed).
- Build-vs-reuse infra map + multi-agent collaboration protocol (`docs/agents/`).
- GitHub private remote `sorachang1874/genius-x`; PR + CI review flow.
- **contracts v0** frozen & tagged: enums, course-config, ws-events, ai-response
  (AiMeta source/degraded, SafetyResult, TraceSink), student model, errors + data/privacy.
- P0.5: `pnpm typecheck` green across 5 packages; `lesson-001.ts` typed = contract
  preflight; `docker-compose` (PG/Redis); `@genius-x/config` runtime modes; CI gate.

## Recent decisions

- D1 name in Lesson 2 · D2 both A/B lines (A-line primary) · D3 provider-agnostic, eval later.
- Primary path (Lesson 1 must-haves) vs shadow path (pluggable, can't break class).
- Roster: Claude Code (lead/contracts/runtime/gateway) · Codex (UI/tests/PR review) · Aider+China model (on-VPS).

## Open risks

- Fake-provider simulation harness + Lesson-1 smoke still to build (lands with M2 — needs gateway).
- Contract amendment C1 (shape per-variant interaction) pending before B-line (NEXT_TODO).
- China access: do not run Claude Code on the Tencent VPS (author offshore, run in China).

## Handoff — next agent starts here

1. Read: `AGENTS.md`, `docs/agents/README.md`, `docs/contracts/`, `NEXT_TODO.md`.
2. Run: `pnpm install && pnpm typecheck`; `docker compose up -d` for PG/Redis.
3. M1 (Agent C, Claude Code): XState stage machine consuming `lesson001` + Socket.IO sync
   using `@genius-x/contracts` ws-events + reconnect/resume. Branch + PR, never auto-merge.
