# Multi-Agent Collaboration Protocol

How AI coding agents (Claude Code, Codex, Aider, …) work this repo together — including
unattended/overnight — without producing code that "each runs but doesn't fit together."
Grounded in 2025-2026 best practice (git worktrees + contract-first + CI-as-DoD + AGENTS.md
briefs). Keep it lightweight; graduate to heavier orchestration only when warranted.

## Two load-bearing rules

1. **Contracts freeze before fan-out.** Shared types/APIs/schema/WS events live in
   `@genius-x/contracts` and are authored/frozen by ONE owner (Agent E / lead) *before* any
   parallel work. Downstream agents import them **read-only**. A task needing a contract
   change is re-serialized through the lead — never edited in a worker branch.
2. **Shadow systems must not break the classroom.** Payload CMS, Better Auth, Langfuse,
   promptfoo are pluggable. Lesson 1 must run if any of them is absent/down. See `AGENTS.md`.

## Ownership map

| Agent | Owns | Directory | Default coding agent |
| --- | --- | --- | --- |
| A | Assistant / control surface | `apps/web/src/assistant` | Codex |
| B | Student classroom flow | `apps/web/src/student` | Codex |
| C | Course runtime (state machine, WS, API) | `apps/server` | Claude Code |
| D | AI gateway (safety, budget, routing, fallback) | `packages/ai-gateway` | Claude Code |
| E | Contracts, schema, docs, **test harness** | `packages/contracts`, `docs/`, `tools/` smoke | Claude Code (lead) |
| F | Platform shadow (CMS, auth, Langfuse, promptfoo) — pluggable | `apps/cms`, `packages/auth`, `tools/` | Codex / Aider |

One owner per disjoint path set. Two agents never edit the same contract/schema unless the
lead owns the merge.

## Per-cycle lifecycle

1. **Freeze contract.** Lead authors/freezes the shared surface for this cycle. Commit.
2. **Write `TASKS.md`** (repo root): disjoint, path-owned, dependency-ordered tasks; mark
   which are parallel-safe. Agents read it but don't edit it during work.
3. **Write a task brief per task** (`docs/agents/briefs/<task>.md`, from
   `docs/agents/_TASK_BRIEF.template.md`): goal, non-goals, owned paths, frozen-contract
   refs (read-only), context docs to read, validation commands, DoD checklist, do-not-touch
   list, anti-gaming rules, handoff format.
4. **Design note + review (before coding).** The owning agent writes a short internal
   design note (architecture, key types/modules, approach, risks) against the module's
   boundary contract. **Lead reviews and approves before any code is written.** This is the
   Layer-2 gate: boundary contracts are frozen up front; internal design is caught here, not
   pre-frozen (avoids both integration drift and big-design-up-front waste).
5. **Fan out**: one **worktree + branch + PR** per task. Assign each worktree its own port
   and test DB/schema. Gitignore the worktrees dir; use `.worktreeinclude` for `.env`.
6. **DoD gate** (CI on the PR, in order): contract preflight → `tsc --noEmit` → lint →
   unit tests → scripted Lesson-1 smoke (fake providers). All green = mergeable, not merged.
7. **Review**: independent-review gate (below) → lead/founder reads the diff for *semantic*
   correctness and over-refactoring (CI already vouches for non-breakage). Merge manually.

## Independent review gate

Significant artifacts — **design notes, contract changes, and PRs** — get an **independent
review before founder sign-off**, by an agent that is **not the author** and ideally a
**different model** (e.g. Codex / GPT-5.5 reviewing Claude's output). Different models catch
different failures; the author has blind spots (proven: the v1 lesson-runtime design shipped
3 blockers the author missed, caught only by independent review).

- The lead spawns/raises the review, reads its findings, reconciles, and surfaces them to the
  founder — the lead does not self-certify its own design.
- The reviewer is adversarial: find what's wrong/risky, do not rubber-stamp.
- This is "verifier ≠ generator" made standing, not optional.

**How we run it (Codex / gpt-5.5):** every review prompt starts with `docs/agents/REVIEW_BRIEF.md`
(standing context: principles, goals, constraints, output format), then names the changed
files + change-specific questions, at `-c model_reasoning_effort="xhigh"`.

Operational rules (root-caused the hard way — a `codex exec` "22-min hang" was NOT network or
xhigh-slowness: codex was **blocked reading stdin** ("Reading additional input from stdin…"),
sleeping on fd 0 at 0% CPU. The fix is one redirect):

- **Always run `codex exec` with `< /dev/null`** so it uses the prompt arg and never blocks on
  stdin. With that, **xhigh works fine even on multi-file reviews** (a real review completed in
  ~4 min, full output).
- **Never** pipe codex through `tail`/`head` (they buffer until EOF and hide all progress) —
  redirect to a file and read it.
- Wrap in a hard `timeout` (e.g. 420s for a big review) as a backstop; `--sandbox read-only` so it never edits.
- Reserve the founder's **interactive Codex CLI** for the rare review too large/iterative for one shot.

## Definition of Done (anti-gaming)

An agent is done when it has an **evidence trail**, not when code compiles. Forbidden in any
task: `--no-verify`, `as any` to silence types, `.skip()`/disabled tests, no-op stubs that
make checks pass without behavior. The verifier must not be the generator.

## Overnight / unattended safety

- Run headless (`claude -p`, `codex --full-auto`) **inside a container/microVM**, never on
  the host or the production VPS.
- **Scoped tool allowlist** (e.g. `Read,Edit,Bash(pnpm test)`), not blanket bypass.
- Default-deny network + explicit allowlist; scoped **non-prod** credentials only.
- **Never auto-merge to main.** Each task opens a PR + writes `STATUS.md`; human merges.
- Log every run (JSON output → cost/tokens), cap concurrency.

## Heterogeneous routing (by strength)

| Task type | Route to | Why |
| --- | --- | --- |
| Contracts / schema / shared types | **Claude Code** | Highest-stakes semantics; deepest reasoning |
| Server state machine, WS, AI gateway | **Claude Code** | Stateful, invariant-heavy correctness |
| Frontend UI (student/assistant) | **Codex** (+ Cursor for hands-on) | High-volume componentry, fast iteration |
| Test harness, unit/integration tests | **Codex** (cloud → PR) | Throughput, parallelizable overnight |
| PR code review | **Codex GitHub review** | Strong at catching real bugs inline |
| Docs / large-context analysis | **Gemini CLI** (cheap) or Claude | Broad reads |
| Large cross-cutting refactors | **Claude Code** | Multi-file coherence |
| Tasks that MUST run on the China VPS | **Aider + DeepSeek/Qwen/GLM** | Only reliable in-country option |

## China authoring/runtime split (load-bearing)

Coding agents that call foreign model APIs (Claude Code, Codex, Gemini, Copilot) are
restricted from mainland China — Claude Code most aggressively (per-request IP checks).
**Author offshore / on a dev machine; deploy/run in China.** Do NOT run Claude Code on the
Tencent VPS. The `call AI only through @genius-x/ai-gateway` rule lets the *product* swap to
a China-accessible model independent of which *coding agent* wrote the code. Never use
grey-market proxy "transfer stations" for a children's product.

## Single source of truth

`AGENTS.md` is the shared brain (Codex/Cursor/Gemini/Aider read it natively). Claude Code
reads it via the `CLAUDE.md` → `@AGENTS.md` shim. Aider: launch with `--read AGENTS.md`.
Per-package `AGENTS.md` may be added when a subtree needs local rules.

## Graduate later (don't adopt now)

Claude Squad / Parallel Code (run 3+ heterogeneous agents side by side) · ComposioHQ `ao`
(fleet management at 5+ concurrent) · GitHub Spec Kit (formalized spec→plan→tasks) · Docker
Sandboxes microVMs (stronger overnight isolation).
