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
- **User-invisible fallback must stay operator-visible** — logged, counted, surfaced in
  preflight/metrics. A fallback invisible to operators is a silent normal path.
- **Model output is a contract** — version prompts, validate output against schema at the
  boundary, keep records for review/rollback (see playbook `10-prompt-and-model-output-contracts.md`).

## The degradation principle (key reconciliation)

The product rule "no failure state" and the engineering rule "no hidden fallback" are
**both** in force. Reconcile them like this:

> **A fallback / degraded response must be invisible to the child, but its use must be
> visible to operators** — logged, counted, and surfaced in preflight/metrics.

Never make a fallback a silent normal path. If the AI gateway serves a fallback, it
records that it did so.

## Shadow systems must not break the classroom

Platform infrastructure (Payload CMS, Better Auth, Langfuse, promptfoo) is **pluggable, not
required**. Lesson 1 must run end-to-end if any of them is absent or down:

- Lessons load from git (`lesson-001.json`) by default; Payload is an alternate source.
- Students join via room-code/QR by default; full Better Auth RBAC is additive.
- Tracing emits to a `TraceSink` fire-and-forget (async, timeout, errors swallowed); the
  default sink is no-op/console. Langfuse down ⇒ classroom unaffected.
- Prompts live in git (versioned files + `PROMPT_CONTRACT`); runtime prompt-fetch from
  Langfuse is a later enhancement, not an MVP dependency.

Each shadow system's contract doc must state `failure mode = does not affect the classroom`.

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
| D | AI gateway (safety, budget, routing, fallback, **brand-style injection**, **tool dispatch** — tools bind to a closed gateway mechanics enum, tool.md) | `packages/ai-gateway` |
| E | Contracts, schema, docs, **test harness** | `packages/contracts`, `docs/`, smoke harness |
| F | Platform shadow (CMS, auth, Langfuse, promptfoo) — pluggable | `apps/cms`, `packages/auth`, `tools/` |

**Phase 1+ (Scalable Architecture v2.0) additions:**

| Agent | Owns | Directory |
| --- | --- | --- |
| G | Identity & enrollment (student/parent/tenant) | `apps/server/src/identity` (or future `apps/identity-service`) |
| H | Student workspace (works, interactions, memories, **IP character entity & version history**) | `apps/server/src/workspace` (or future `apps/workspace-service`) |
| I | Agent service (context building, memory retrieval, **in-scene multi-round running context**) | `apps/server/src/agent` (or future `apps/agent-service`) |
| J | Content pipeline (media storage, processing, **brand-style conformance checks**) | `apps/server/src/content` (or future `apps/content-service`) |
| K | Parent surfaces (H5, miniapp, co-working) | `apps/web/src/parent` |

**Anchor reframe (2026-06-09, founder-ratified)**: the development anchor is the evolving
personal **IP character** (the child's AI friend, brand-recognizable, continuously refined);
the birth certificate is lesson-001's ritual = the character's v1.0 snapshot. Decisions and
design principles (AI-first schema validation over closed vocabularies; layered IP model —
locked base canon / refinable surface / temporary skins; broad instrumentation without
scoring; premium-over-cost) live in `docs/product/ip-character-concept-decisions.md` —
read it before designing any Phase 4+ feature.

Avoid two agents editing the same contract or schema unless one lead owns the merge.
Each handoff: changed files, what was validated, residual risk, next step.

## Parallel and autonomous work

Full protocol: `docs/agents/README.md`. Hard rules:

1. **Contracts freeze before fan-out.** `@genius-x/contracts` + `docs/contracts/` are
   authored/frozen by the lead before parallel work; workers import them **read-only**. A
   contract change is re-serialized through the lead, never edited in a worker branch.
2. **One owner-bounded task per agent**, on its own **worktree + branch + PR**. Assign each
   worktree its own port and test DB. Never edit another agent's owned paths.
3. **Never auto-merge to main.** CI (DoD gate) must be green; a human merges after review.
4. **Definition of Done = evidence, not compilation.** Gate order: contract preflight →
   typecheck → lint → unit → scripted Lesson-1 smoke (fake providers). No `--no-verify`,
   `as any`, `.skip()`, or no-op stubs. The verifier is not the generator.
5. **Author offshore, run in China.** Do not run foreign-model coding agents (esp. Claude
   Code) on the Tencent VPS; they are IP-restricted in mainland China.

## Single source of truth

This file is read natively by Codex/Cursor/Gemini/Aider. Claude Code reads it via the
`CLAUDE.md` → `@AGENTS.md` shim. Aider: launch with `--read AGENTS.md`. Do not maintain
parallel rule files.

## Commands

- TS workspace: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`
- Python tools: `cd tools && source .venv/bin/activate`

(Framework-specific dev/test commands will be added as each app is built.)
