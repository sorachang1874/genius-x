# Contract: AI Gateway

> Owner: **Agent D** (`packages/ai-gateway`). Boundary contract — public capability surface
> frozen before fan-out; provider routing/internals via per-task design note. Types:
> `@genius-x/contracts` (ai-response). Reuse: Vercel AI SDK + Zod, Tencent adapters, 天御.

## Purpose

The single entry point for all AI. Business code calls these capability methods; the gateway
owns prompt building, input/output safety, budget, provider routing, fallback, and audit.
Provider choice (D3) is internal and swappable.

## Public interface (what Agent C calls)

| Method | Input | Output |
| --- | --- | --- |
| `llm(req)` | promptVersion + input | `LlmTextResult` |
| `tts(req)` | text | `TtsResult` |
| `asr(req)` | audio **ref** (not raw audio) | `AsrResult` |
| `imageGen(req)` | img2img/text2img source + count | `ImageGenResult` (moderated) |
| `extractMemory(input)` | child utterance | `MemoryExtraction` |
| `birthSpeech(profile)` | name + memories + tag | `LlmTextResult` |

Every result carries `AiMeta { source, degraded, promptVersion?, latencyMs? }`. **Methods
never throw to the caller** — on any failure they return a fallback with `degraded: true`.

## Internal pipeline (PRD §5.2)

```
request-builder → safety(input) → token-budget → provider-router (ProviderAdapter)
  → safety(output) → fallback(on fail/timeout/filtered/schema-miss) → audit (TraceSink)
```

Provider routing is **not a frozen contract** (swappable). What IS contractual: the methods
above and their output schemas (`@genius-x/contracts`).

## Consumes / Produces

- **Consumes:** `ProviderAdapter` (fake in scripted mode / Tencent in live), git prompt
  templates (versioned), 天御 moderation, `TraceSink` (shadow — fire-and-forget).
- **Produces:** validated `AiResult` (always), `SafetyResult`, redacted trace events.

## SLOs (PRD §10.1)

| Capability | Budget | On breach |
| --- | --- | --- |
| `llm` | ≤ 8 s | fallback (`degraded:true`, logged) |
| `tts` first packet | ≤ 2 s | fallback line |
| `imageGen` | ≤ 15 s | preset illustration |
| budget | input ≤500 / output ≤150 tok; ≤20k tok/student/class | truncate or fallback, never error |

## Acceptance criteria (testable on the harness)

- On provider error/timeout/filtered/schema-miss → a fallback is returned (`degraded:true`)
  and the fallback is **counted/logged** (operator-visible degradation).
- Filtered/unsafe output never reaches the caller.
- `imageGen` runs a moderation **seam** before returning (`imageModerator` hook): when a
  moderator is injected, a block → fallback; M2a ships the seam with no moderator and traces
  `moderation_deferred_m6`; the real 天御 IMS moderator is injected in M6.
- No raw child audio is persisted (asr takes a ref; data-and-privacy).
- A `TraceSink` outage does not slow or break any call (shadow).

## Failure mode

**Primary** (the gateway + fallback library). Providers may fail → fallback. TraceSink is
**shadow** (must not affect calls). Prompts load from git, not a runtime Langfuse dependency.
