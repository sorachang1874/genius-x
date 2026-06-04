# Genius X

> **AI Native 一代，不漏下我们的孩子。**
> 面向 4-10 岁孩子的 AI 启蒙 —— 用 AI 创造、表达、交流，而不是学 AI 原理。

This is the Genius X monorepo. Read the product soul first:
[`docs/product/genius-x-manifesto.md`](docs/product/genius-x-manifesto.md).

## Three hard product lines (every decision passes these)

1. **浸泡式，不教学式** — immersive, not instructional. No quiz/test logic.
2. **用 AI，不学 AI** — no "Prompt / LLM / token / AI" wording on screen.
3. **无失败状态** — every input gets a positive output. No visible failure state for the child.

## Repository map

```
apps/
  web/         React PWA — student + assistant (one app, role-separated internally)
  server/      Course state machine + WebSocket classroom sync + API
packages/
  contracts/   ⭐ single source of truth: schemas, API/WS types, AI response shapes, enums, errors
  ai-gateway/  the only entry point for AI calls (safety, budget, routing, fallback, audit)
  course-config/ lesson JSON configs + validation (new lessons = data, not code)
tools/         🐍 Python offline layer (.venv): prompt eval, content analysis, safety experiments
docs/
  product/     manifesto, MVP PRD, lesson-1 rundown, 16-lesson course design
  contracts/   prose contracts (owner matrices, allowed values, deletion conditions)
  architecture/ architecture overview
```

## Stack

- **Main app:** Node 22 / TypeScript (unified pipeline). pnpm workspaces.
- **Offline tools:** Python 3.12 in `tools/.venv` (decoupled from the main pipeline).

## Quick start for Demo

```bash
# One-command start (server + web app)
./demo-start.sh

# Then open in browser:
# • Assistant: http://localhost:5173/?role=assistant
# • Student:   http://localhost:5173/
```

📖 **Full demo guide:** [`docs/demo-live-guide.md`](docs/demo-live-guide.md) — includes real interaction (canvas drawing, microphone), multi-student testing, and mobile access.

🧪 **Automated tests:**
```bash
node tools/demo-e2e-test.mjs              # Single student end-to-end
node tools/demo-e2e-multi-student.mjs     # Multi-student concurrent
```

## Getting started (development)

```sh
corepack enable pnpm     # pnpm via Node corepack
pnpm install             # install the TS workspace

# Manual start (separate terminals)
cd apps/server && pnpm dev    # Terminal 1: Backend server
cd apps/web && pnpm dev        # Terminal 2: Frontend app

# Python tools (offline layer)
cd tools && python3 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"
```

## Engineering operating docs

- [`AGENTS.md`](AGENTS.md) — rules for AI coding agents working here (read before changing files).
- [`NEXT_TODO.md`](NEXT_TODO.md) — roadmap, phase status, open product decisions, deletion gates.
- [`PROGRESS.md`](PROGRESS.md) — current state and handoff notes.

This project follows the
[ai-assisted-engineering-playbook](https://github.com/sorachang1874/ai-assisted-engineering-playbook)
(contracts-first, no hidden fallback, short feedback before long, environment isolation).
