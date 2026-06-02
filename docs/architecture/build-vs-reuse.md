# Build vs Reuse — infrastructure map

> Status: **research synthesis, adoption proposed (pending confirmation)**. Last updated 2026-05-31.
> Goal: reuse undifferentiated infra (realtime, state, auth, CMS, AI plumbing, observability)
> so build effort concentrates on the **AI+ core** (I-T-O experiences, memory extraction,
> birth certificate, prompt contracts, child safety).

## Decision frame

One non-engineer founder + AI agents · single Tencent Cloud Lighthouse VPS in China ·
~15 iPads · one 60-min lesson. Bias: batteries-included, TS-native, **self-hostable /
China-accessible**. Overseas hosted SaaS (Liveblocks, Ably, Clerk, Inngest, OpenRouter,
Cloudflare) = latency + GFW + children's-data-compliance risk → excluded from the live path.

## REUSE (off-the-shelf, self-host in China)

| Layer | Pick | License | Why this one |
| --- | --- | --- | --- |
| Realtime classroom sync | **Socket.IO** | MIT | Single Node dep, zero extra infra; rooms = per-class/per-stage push; we keep authoritative state + explicit resume in our server |
| Lesson state machine | **XState v5** | MIT | Our stage sequence IS a statechart; typed, testable, visual, in-process, nothing to host; persist "current stage" per transition |
| Course-authoring CMS | **Payload CMS v3** | MIT | TS-native, Array/Blocks/JSON fields map onto nested lesson config; admin UI for a non-engineer; types flow into the monorepo |
| Auth + RBAC | **Better Auth** | MIT | Lucia is deprecated (2025); runs embedded in our Node app + Postgres; access-control plugin covers the 5 roles |
| PWA / offline | **vite-plugin-pwa (Workbox)** | MIT | Standard SW/precache; pre-fetch lesson config + fallback library at class start = the real "class never stalls" lever |
| Prompt registry + tracing + runtime eval | **Langfuse** (self-host) | MIT | Versioned prompts (cached, no added latency), redacted tracing, regression eval, in-China data residency |
| Offline eval + safety red-team | **promptfoo** | MIT | Local/air-gapped batch eval + OWASP-LLM/NIST red-team presets; lives in `tools/` |
| LLM call layer + structured output | **Vercel AI SDK + Zod** | Apache-2.0 / MIT | TS-native; type-safe output validation at the boundary; OpenAI-compatible → Hunyuan |
| Content moderation | **Tencent 天御 (T-Sec): TMS text + IMS image** | SaaS (in-region) | In-China, legally aligned (《未成年人网络保护条例》), minor-protection mode; moderates child input, doodles, AND generated images |
| Parent end | **WeChat-optimized H5** (our React stack) | — | Read-only birth cert + report; no separate toolchain/registration vs Mini-Program |
| Monorepo | **pnpm workspaces** now | MIT | Sufficient at this size; add Turborepo only when CI/builds drag |

## BUILD CUSTOM (our differentiated logic — keep it thin)

- **AI Gateway** (Node/TS): prompt-build from Langfuse-versioned templates → layered safety
  pipeline (keyword → 天御 → optional LLM-judge) on **input AND output** → token/cost budget
  → provider routing (primary + fallback) → **deterministic fallback-response library** →
  audit (emit to Langfuse). Plus thin adapters wrapping Tencent **TTS / ASR / img2img** — the
  multimodal surface no generic gateway owns well.
- **Lesson runtime** domain logic (stage rules, durations, Q&A-tree traversal, fallback
  selection) — built on XState.
- **Classroom realtime control** (assistant unlock / teacher projection → student devices) —
  built on Socket.IO + Redis pub/sub; authoritative state ours.
- **Student no-password join** (QR / room-code → short-lived session) — on Better Auth.
- **Offline pre-fetch + write-replay queue** — on vite-plugin-pwa.
- The actual **I-T-O experiences, memory extraction, birth certificate** — the product.

## BORROW PATTERNS (not dependencies)

LiteLLM (budget / virtual-key / fallback design) · Portkey OSS (TS guardrail hooks, multimodal
routing) · Colyseus (room + authoritative-state model) · Instructor (retry-on-validation loop).

## FORWARD-LOOKING (adopt only when the need is concrete)

- Realtime at scale (many classrooms / multi-node) → **Centrifugo** (self-host, China-friendly,
  2025 map-subscriptions = recoverable authoritative state).
- Durable sessions (survive crashes / long-running) → **Restate** first (lighter), **Temporal**
  when full guarantees are worth the multi-service ops.
- Timed mechanics (auto-advance stage after N min) → **BullMQ** (needs Redis we already have).
- Course-authoring beyond CMS / ops dashboards → **React-Admin** or **Refine**.
- Fine-grained lesson/classroom-scoped permissions → **Casbin** on top of Better Auth.
- Parent discoverability / WeChat Pay → **Mini-Program**. Build caching → **Turborepo**.

## Proposed MVP adoption scope

- **Adopt now (needed to run Lesson 1):** Socket.IO, XState, Vercel AI SDK + Zod, custom AI
  Gateway, Tencent LLM/TTS/ASR/img2img + **天御 moderation**, fallback library, vite-plugin-pwa
  (basic), promptfoo in `tools/`.
- **Adopt early (high-leverage, recommended):** **Langfuse** — prompt registry + tracing + eval
  is the center of the AI-iteration loop; self-hosted, low runtime cost. *(open decision)*
- **Fast-follow (not required for one lesson):** **Payload CMS** (hand-author `lesson-001.json`
  in git for MVP; add the CMS when authoring Lesson 2+). Full **Better Auth RBAC** (start with a
  lightweight room-code student join + minimal role check). *(open decision)*
- **Later:** parent H5 (M5), Turborepo, Mini-Program, Centrifugo, durable-execution engine.

## China provider primary / fallback shape

- **LLM:** Tencent Hunyuan (OpenAI-compatible) → second in-China model → deterministic library.
- **TTS / ASR:** Tencent Cloud TTS / ASR → alternate in-China vendor → pre-recorded audio for key lines.
- **Image:** Tencent Hunyuan image / in-China img2img → **天御 IMS before display** → pre-approved illustration set.
- Hard rule: no OpenAI / ElevenLabs / Deepgram / OpenRouter / Cloudflare on the primary path;
  overseas models stay in offline eval (`tools/`) or a clearly-flagged non-default fallback.
