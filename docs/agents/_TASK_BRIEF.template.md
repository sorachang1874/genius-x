# Task Brief: <task-id> — <short title>

> Owner agent: <A-F> · Coding agent: <Claude Code / Codex / Aider> · Branch: `<branch>`

## Goal

What must be true when this task is complete (one outcome).

## Non-goals

What must NOT change.

## Owned paths

- `<dir/file>` (you may edit)

## Do-not-touch

- `packages/contracts/**` and `docs/contracts/**` are FROZEN this cycle — read-only.
- `<other no-touch>`

## Frozen contracts to import (read-only)

- `@genius-x/contracts`: <which types>
- Contract docs: `docs/contracts/<...>.md`

## Context to read first

- `AGENTS.md`, `docs/agents/README.md`
- `docs/product/<relevant>.md`
- `docs/architecture/build-vs-reuse.md` (chosen libs/patterns)

## Implementation notes

- Libraries/patterns to use (e.g. XState, Socket.IO, Vercel AI SDK + Zod).
- Patterns to borrow; pitfalls to avoid.

## Validation (Definition of Done)

```sh
pnpm typecheck && pnpm lint && pnpm test
# + contract preflight, + scripted Lesson-1 smoke (fake providers)
```

No `--no-verify`, no `as any`, no `.skip()`, no no-op stubs.

## Stop conditions (ask the lead)

- A contract direction needs to change.
- A destructive migration is required.
- A shadow system would become required for Lesson 1 to run.

## Handoff (fill on completion)

- What changed · What was validated · What failed/not run · Files touched · Residual risk · Next step
