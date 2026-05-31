# PROGRESS

## Last updated

2026-05-31

## Current state

Project scaffolding (P0). No business logic yet — this is environment + structure + docs.

Done:

- `git init` (branch `main`), `.gitignore`, `.nvmrc` (Node 22).
- pnpm enabled via corepack (11.5.0); `pnpm-workspace.yaml`, root `package.json`, `tsconfig.base.json`.
- Monorepo skeleton: `apps/web`, `apps/server`, `packages/{contracts,ai-gateway,course-config}`, `tools/`, `docs/`.
- Per-package README + minimal package.json + placeholder src (no framework deps installed yet).
- Product docs relocated to `docs/product/` (manifesto, PRD, lesson-1 rundown, course design).
- Python offline layer: `tools/.venv` (3.12), `tools/pyproject.toml`, subdirs.
- Engineering docs: `README.md`, `AGENTS.md`, `NEXT_TODO.md`, this file; contract skeletons in `docs/contracts/`.

## Recent decisions

- Stack: Node/TS main app; Python only for the offline/experiment layer (`tools/`).
- Structure: monorepo with a dedicated `@genius-x/contracts` source-of-truth package
  (avoids cross-repo drift while keeping clean per-agent directory boundaries).
- Student + assistant: one web app, role-separated internally (per PRD), splittable later.

## Open risks

- No framework chosen/installed yet (Vite/React for web, Fastify for server are recommendations).
- Product decisions D1-D3 (NEXT_TODO) gate Stage-2 implementation.

## Handoff — next agent starts here

1. Read: `AGENTS.md`, `docs/contracts/`, `docs/product/genius-x-mvp-prd.md`.
2. Decide D1-D3 (NEXT_TODO open decisions) with the founder.
3. Fill `@genius-x/contracts` for the course state machine + WebSocket events (M1), contract-first.
4. Validate: `pnpm install` then `pnpm typecheck`.
