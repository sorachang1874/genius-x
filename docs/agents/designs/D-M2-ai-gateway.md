# Design Note: D-M2 — AI Gateway + fake harness + interaction wiring

> Status: **proposed, pending founder/lead approval** (Layer-2 gate). No code until approved.
> Owner: Agent D. Contracts: `docs/contracts/ai-gateway.md`, `safety.md`. Implies contracts-v1.3.

## Goal

Make stages actually produce AI content, via the single gateway, on **fake providers**
(deterministic, zero keys, zero cost). This is the "AI+" core and what lets a demo show content.

## 1. Gateway public surface (`packages/ai-gateway`)

Capability methods the server calls; each runs the pipeline and **never throws** (returns a
fallback with `meta.degraded=true` on any failure):

| Method | Used by |
| --- | --- |
| `llm(req) → LlmTextResult` | icebreak reply, talent story/answer, birth speech |
| `tts(req) → TtsResult` | speak any text |
| `asr(req) → AsrResult` | transcribe a child's voice (takes an audio **ref**, never raw audio) |
| `imageGen(req) → ImageGenResult` | shape (doodle/dialogue → candidate avatars) |
| `extractMemory(req) → MemoryExtraction` | background memory point from talent |

Pipeline (PRD §5.2): build prompt from a **versioned git template** → input safety → token
budget → route to `ProviderAdapter` → output safety → fallback (timeout/fail/filtered/schema
miss) → audit via `TraceSink`. Output validated (Zod) against the contract shape at the boundary.

## 2. Fake provider simulation harness

Upgrade the skeleton `FakeProvider` to honor `FakeProviderConfig` fault injection:
latency, fail, timeout, filteredOutput; async image flow (submit→poll with injected delay).
Deterministic canned content. Scenario presets (slow / down / filtered) for the smoke. This
is what makes overnight/CI development and SLO assertions possible without real providers.

## 3. Interaction lifecycle — the key design decision

A child interaction is: **input → AI thinking → output**, possibly many times per stage,
distinct from "choosing/finishing". Proposed flow:

```
client ──INTERACT{stageId,variantId?,input}──▶ server
  server resolves the stage's interaction spec → reducer emits CALL_INTERACTION
  InteractionRunner runs the gateway capability(ies) for that interaction
  server ──AI_OUTPUT{studentId,stageId,result}──▶ client   (render: play audio / show images / text)
  server feeds INTERACTION_DONE{degraded} back into the engine (counts toward minInteractions)
```

**Contract additions (contracts-v1.3) — the decision to confirm:**
- **`INTERACT` ClientMessage** = an interaction *input*: `{ studentId; stageId; variantId?;
  input }` where input is `voice{audioRef}` | `doodle{doodleRef}` | `answers{Record}` |
  `talent{option}`. Separate from `STAGE_COMPLETE`, which keeps `selection`/`variantChoice`/
  `done` (a *choice/finish*, not an interaction). This cleanly separates "I did a thing with
  the AI" from "I picked/finished".
- **`AI_OUTPUT` ServerMessage** = `{ studentId; stageId; result: AiResult }` — delivers AI
  content to the one student. (`AI_READY` already exists for pre-generated birth speech.)

> Alternative considered: overload `STAGE_COMPLETE` (its `voice`/`doodle` kinds) as the
> trigger. Rejected — it conflates "interaction input" with "stage finished" (talent needs
> many interactions before finishing), and muddies the gate semantics. Recommend `INTERACT`.

## 4. CALL_INTERACTION wiring (server)

`InteractionRunner` (new, `apps/server/src/interaction/`): given a `CALL_INTERACTION`, look up
the stage/variant interaction spec, call the gateway, deliver `AI_OUTPUT`, then reduce
`INTERACTION_DONE`. The reducer emits `CALL_INTERACTION` when it accepts an `INTERACT` event.
Birth speech is pre-generated on stage entry → `AI_READY` → child taps play → `AI_OUTPUT`.

## 5. Scope / split

- **M2a**: gateway core (capabilities + pipeline + fake harness + output validation + fallback) — unit-testable in isolation.
- **M2b**: contracts-v1.3 (`INTERACT`, `AI_OUTPUT`, payload refactor) + `InteractionRunner` +
  reducer `INTERACT`→`CALL_INTERACTION` + e2e (icebreak voice round-trip on fakes).

Two PRs, each branch + Codex review.

## Decisions to confirm

1. Interaction model: add **`INTERACT`** (recommended) vs overload `STAGE_COMPLETE`?
2. `AI_OUTPUT` ServerMessage shape (carry the full `AiResult`?) OK?
3. Split M2 into M2a (gateway) + M2b (wiring), gateway first — OK?

## Out of scope (later)

Real Tencent providers + 天御 moderation (D3/M6) · prompt eval/Langfuse (shadow) · streaming TTS.
