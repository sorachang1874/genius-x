# Architecture Overview

The authoritative spec is `docs/product/genius-x-mvp-prd.md` §3. This is the orientation
map; keep it short and link out.

## Layers

```
Client (apps/web)            React PWA on iPad — student + assistant, one app, role-separated
   │  HTTPS / WebSocket
Server (apps/server)         course state machine + classroom sync + API
   │
AI Gateway (packages/ai-gateway)   the only path to AI: safety, budget, routing, fallback, audit
   │
Providers                    LLM / TTS / ASR / image gen (primary + fallback, swappable)

Shared: @genius-x/contracts (types), @genius-x/course-config (lessons as data)
Offline: tools/ (Python — prompt eval, content analysis, safety experiments)
```

## Key decisions

- **Contracts-first monorepo.** `@genius-x/contracts` is the single source of truth; nothing
  redefines shared types locally. New lessons are config (`course-config`), not code.
- **AI is isolated behind one gateway.** The course flow advances even if AI fails.
- **Node/TS main pipeline; Python only offline.** Promote a Python tool to a service (with
  its own contract) only if a capability genuinely outgrows the main pipeline.

## Runtime modes (to formalize — see playbook runtime isolation)

local dev · scripted/fake-provider · local live (budgeted) · production (Tencent Lighthouse).
Keep data, keys, and storage prefixes isolated per mode; select mode via central config,
not ad-hoc env vars.
