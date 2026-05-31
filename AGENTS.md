# AGENTS.md — Genius X

Rules for AI coding agents working in this repository. Adapted from the
ai-assisted-engineering-playbook. Read this before changing any files.

## Read first

1. `docs/product/genius-x-manifesto.md` — product soul. All decisions return here.
2. `docs/product/genius-x-mvp-prd.md` — the MVP requirement spec.
3. `docs/product/genius-x-lesson1-rundown.md` — the lesson this MVP must run end-to-end.
4. The contract for the area you are touching, under `docs/contracts/`.

## Role

Act as a senior engineer. Optimize for correctness, maintainability, and one-pass
delivery over narrow local patches. The dev team is one non-engineer founder plus AI
agents — so **the docs and contracts ARE the team's shared memory**. Keep them current.

## Hard product rules (bind technical work too)

- **No quiz/test logic.** Experiences, not exercises (浸泡式).
- **No "Prompt / LLM / token / AI / model" wording in any child-facing UI.** It's a friend.
- **No visible failure state for the child.** Every input gets a positive output.
- **Latency is dressed as "thinking"** (animation + copy), never a blank wait.

## The degradation principle (key reconciliation)

The product rule "no failure state" and the engineering rule "no hidden fallback" are
**both** in force. Reconcile them like this:

> **A fallback / degraded response must be invisible to the child, but its use must be
> visible to operators** — logged, counted, and surfaced in preflight/metrics.

Never make a fallback a silent normal path. If the AI gateway serves a fallback, it
records that it did so.

## Working rules

Before changing files:

1. Restate the real engineering goal.
2. Identify affected modules, contracts, docs, tests, and the course/classroom flow.
3. Search all usages before changing shared semantics.
4. Prefer bounded root-cause fixes over symptom patches.

During implementation:

1. Keep shared semantics in `@genius-x/contracts` — never redefine shared types locally.
2. Call AI only through `@genius-x/ai-gateway` — never a provider SDK directly.
3. Keep the course state machine able to advance even when AI fails.
4. Update docs and tests with behavior changes.
5. Do not add hidden fallback paths.

Before completion:

1. Run targeted validation.
2. Report what changed, what was validated, and what remains (honestly).

## Contract discipline

Any shared field, state, event, status text, error code, WebSocket message, or AI output
shape must define: owner, source of truth, allowed values, derivation, consumers, fallback
status, migration status, deletion condition, and a fast preflight that catches drift.
Define the contract in `docs/contracts/` **before** relying on the field.

## Agent ownership map (for parallel work)

| Agent | Owns | Directory |
| --- | --- | --- |
| A | Assistant / control surface | `apps/web/src/assistant` |
| B | Student classroom flow | `apps/web/src/student` |
| C | Course runtime (state machine, WS, API) | `apps/server` |
| D | AI gateway (safety, budget, routing, fallback) | `packages/ai-gateway` |
| E | Contracts, schema, docs, tests | `packages/contracts`, `docs/contracts` |

Avoid two agents editing the same contract or schema unless one lead owns the merge.
Each handoff: changed files, what was validated, residual risk, next step.

## Commands

- TS workspace: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`
- Python tools: `cd tools && source .venv/bin/activate`

(Framework-specific dev/test commands will be added as each app is built.)
