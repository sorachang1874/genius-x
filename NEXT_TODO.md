# NEXT_TODO

## Current objective

MVP (V0.5): run **Lesson 1** (认识我的 AI 好朋友, 60 min) end-to-end for one class.
See `docs/product/genius-x-mvp-prd.md` §1.

## Phase status

Milestones from PRD §11. Status: `open` / `in_progress` / `blocked` / `done`.

| Phase | Goal | Status | Next step |
| --- | --- | --- | --- |
| P0 | Scaffolding: repo, monorepo skeleton, env (.venv/pnpm), docs/contracts skeletons | `in_progress` | finish contract skeletons + first preflight |
| M1 | Course engine: state machine + WebSocket + stage unlock | `open` | model stages in `@genius-x/contracts` first |
| M2 | AI gateway: provider adapter + safety filter + token budget + fallback library | `open` | write `docs/contracts/ai-gateway.md` owner matrix first |
| M3 | Stages 1-2: voice icebreak + image gen (A-line first) + avatar select | `open` | depends on D2/D3 decisions |
| M4 | Stages 3-4: talent interaction + memory extraction + birth certificate + TTS | `open` | — |
| M5 | Closure + parent: class closure + birth-cert static page + parent report | `open` | — |
| M6 | Test + harden: full-flow load test + content-safety test + real classroom rehearsal | `open` | — |

## Open product decisions (block design — from PRD Appendix D)

| # | Question | Affects | Priority | Recommendation | Decision |
| --- | --- | --- | --- | --- | --- |
| D1 | Naming the companion: Lesson 1 or Lesson 2? | birth cert, profile | P0 | Lesson 2 (Lesson 1 is heavy enough) | — |
| D2 | Build both A-line (doodle) and B-line (dialogue) in MVP, or one first? | Stage 2 (shape) | P0 | A-line first, B-line fast-follow | — |
| D3 | Which image-gen provider? | AI gateway, cost | P0 | evaluate Tencent first; Replicate as fallback | — |
| D4 | External mic vs iPad mic + denoise? | Stages 1/3 | P1 | — | — |
| D5 | Parent report via WeChat message or H5 link? | parent end | P1 | — | — |
| D6 | Tencent Lighthouse spec (CPU/mem/bandwidth)? | deploy | P1 | — | — |

## Deletion gates

Track migration bridges / temporary fallbacks that must be removed before they become
silent normal paths. (None yet — add as they appear.)

| Old path | Replacement | Normal-path blocked? | Deletion condition | Owner |
| --- | --- | --- | --- | --- |
| — | — | — | — | — |
