# Providers + Simulation Harness

The `ProviderAdapter` interface (`types.ts`) is the gateway's swap point. Real Tencent
adapters and the scripted `FakeProvider` both implement it — so provider choice (D3) never
touches business code, and tests run key-free with zero API cost.

## Why a simulation harness, not just stubbed returns

Single-point fake returns don't validate SLOs/SLA. The harness models the **real async
chain** so the full path is exercised:

```
client → server → gateway → provider.imageSubmit → job
       → provider.imagePoll / webhook → ImageGenResult → moderation → WS AI_READY → client
```

Fault injection (`FakeBehavior`) lets a test assert behavior under: provider slow, provider
down, output filtered, no input, iPad refresh mid-stage.

## SLO targets (PRD §10.1) — what the harness asserts

| Capability | Budget | On breach |
| --- | --- | --- |
| LLM text | ≤ 8 s | serve fallback (`degraded:true`, logged) |
| TTS first packet | ≤ 2 s | fallback line |
| Image gen (incl. thinking) | ≤ 15 s | preset illustration fallback |
| WS state sync | ≤ 500 ms | — |
| Concurrency | ≥ 15 students | no stall |

## Acceptance criteria (AI capability boundary)

- Every capability returns within budget **or** a fallback is served and recorded
  (`AiMeta.degraded=true`) — the classroom never stalls (no failure state to the child).
- Filtered/unsafe output never reaches a client (safety pipeline substitutes a fallback).
- Generated images are moderated (天御 IMS) **before** display.
- No raw child audio is persisted (ASR takes a ref; see data-and-privacy contract).

## Status

SKELETON. Interface + fault-injection types + acceptance defined now (Layer-1 boundary
contract). Runtime (latency timers, async job store, optional fake HTTP server + webhook,
SLO assertions) lands with **M2** alongside the gateway.
