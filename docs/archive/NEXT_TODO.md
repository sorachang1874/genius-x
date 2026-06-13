# NEXT_TODO

Single source of plan truth. Product soul: `docs/product/genius-x-manifesto.md`.
Spec: `docs/product/genius-x-mvp-prd.md`. Infra rationale: `docs/architecture/build-vs-reuse.md`.

## Current objective

MVP (V0.5): run **Lesson 1** (认识我的 AI 好朋友, 60 min) end-to-end for one class on ~15 iPads.

## Decisions log

| # | Question | Decision | Date |
| --- | --- | --- | --- |
| Stack | Main language | Node/TS main app; Python only for offline tools (`tools/`) | 2026-05-31 |
| Structure | Repo layout | pnpm monorepo + `@genius-x/contracts` single source of truth | 2026-05-31 |
| D1 | Name the companion: Lesson 1 or 2? | **Lesson 2** — L1 builds the bond (shape+memories), L2 names it. L1 ends on a naming cliffhanger; `geniusXName` stays optional | 2026-06-02 |
| D2 | A-line + B-line both in MVP? | **Both** — but **A-line (doodle) is the primary path that must run**; B-line (dialogue) built in parallel, L1 can open without it | 2026-06-02 |
| D3 | Image provider? | **Provider-agnostic** behind the gateway; build on fake providers, evaluate latency/quality later when keys arrive | 2026-06-02 |
| D4 | Mic: external vs iPad + denoise? | open (P1) | — |
| D5 | Parent report: WeChat msg vs H5? | **WeChat-optimized H5** (later, M5) | 2026-06-02 |
| D6 | Lighthouse spec? | open (P1) | — |

## Primary path vs shadow path

**Primary path** (Lesson 1 depends on these — keep minimal, controllable, reversible):
`@genius-x/contracts` · XState course state machine · Socket.IO classroom sync ·
`lesson-001.json` (git) · AI Gateway + Vercel AI SDK + Zod output validation · Tencent
LLM/TTS/ASR/img2img adapters + **天御 moderation** · fallback-response library ·
**fake-provider simulation harness** · basic PWA precache.

**Shadow path** (build in parallel, pluggable, must NOT gate Lesson 1):
Payload CMS · Better Auth RBAC · Langfuse (async TraceSink) · promptfoo · parent H5 ·
course editor. Rule: connectable / demonstrable, never the sole entry point. Each carries
`failure mode = does not affect the classroom`.

## Agent roster & ownership

Roster: **Claude Code** (lead/architect) · **Codex** (UI/tests/PR review) · **Aider + China
model** (on-VPS tasks). Protocol: `docs/agents/README.md`.

| Agent | Owns | Coding agent |
| --- | --- | --- |
| A | assistant control surface (`apps/web/src/assistant`) | Codex |
| B | student classroom (`apps/web/src/student`) | Codex |
| C | course runtime: XState + Socket.IO + API (`apps/server`) | Claude Code |
| D | AI gateway + Tencent adapters + fallback (`packages/ai-gateway`) | Claude Code |
| E | contracts, docs, **test harness** (`packages/contracts`, `docs/`) | Claude Code (lead) |
| F | platform shadow (`apps/cms`, `packages/auth`, `tools/`) | Codex / Aider |

> **Gate: contracts v0 (authored by the lead / Agent E) must be frozen before the other
> agents fan out.** Founder reviews → freezes → then A–D and F work in parallel.

## Milestones

| Phase | Goal | Status |
| --- | --- | --- |
| P0 | Scaffolding, env, docs, multi-agent protocol, GitHub remote | `done` |
| P0.5 | contracts (→ `contracts-v1.1`) + typecheck-all + preflight + docker-compose + runtime modes + CI gate | `done` |
| M1 | Course engine: generic reducer + guards + Zod validator + Socket.IO sync + persistence + resume (PR #1, #2) | `done` |
| E-M1 | End-to-end smoke: drive Lesson 1 through the real socket/http with fake providers; assert flow + SLOs | `open` (next) |
| M2 | AI gateway: adapter interface + safety (天御) + budget + fallback library + fake-provider simulation harness; wire `CALL_INTERACTION` | `open` |
| M3 | Frontend (`apps/web`): Vite+React PWA; student stages 1-2 (voice icebreak + image gen, A-line) + assistant unlock panel + Socket.IO client | `open` |
| M4 | Frontend+AI: talent + memory extraction + birth certificate + TTS; closure | `open` |
| M5 | Parent H5 + report | `open` |
| M6 | Harden: full-flow + content-safety + classroom rehearsal; swap in real Tencent providers | `open` |

## Deletion gates

Track temporary fallbacks/bridges so they don't become silent normal paths.

| Old path | Replacement | Normal-path blocked? | Deletion condition | Owner |
| --- | --- | --- | --- | --- |
| fake providers | real Tencent adapters | no (scripted mode only) | M6, after live eval | D |

## Tracked contract amendments (post-freeze, via lead re-serialization)

Changes to frozen `contracts-v0` must go through the lead, then re-tag (v0.1, …).

contracts evolved **v0 → v1** (tag `contracts-v1`) after two independent reviews (Claude +
Codex): opaque stage/memory/artifact/output ids, composable+scoped advance conditions,
generic per-student variants, typed runtime state, FORCE_ADVANCE on the wire, ref-typed
`STAGE_COMPLETE` payloads (privacy), full `ClassSession`, reducer effect-commands.

| # | Amendment | Why | When | Status |
| --- | --- | --- | --- | --- |
| C1 | Shape stage: per-variant interaction (A-line + B-line) | needed a per-variant interaction shape | contracts-v1 | **resolved** — generic `StageVariant` model; lesson-001 ships both A/B |
