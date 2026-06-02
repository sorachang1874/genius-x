# Design Note: D-M2 — AI Gateway + fake harness + interaction wiring (v2)

> Status: **finalized after Codex review** (3 decisions confirmed; 6 findings folded in).
> **M2a (gateway core) = GO to implement. M2b (contracts-v1.3 + wiring) = build to this spec.**
> Owner: Agent D. Contracts: `docs/contracts/ai-gateway.md`, `safety.md`. Implies contracts-v1.3.

## Goal

Stages produce AI content via the single gateway, on **fake providers** (deterministic, zero
keys/cost). The "AI+" core and the prerequisite for a demo with content.

## 1. Gateway public surface (`packages/ai-gateway`) — M2a

Capability methods; each runs the pipeline and **never throws** (returns a fallback with
`meta.degraded=true` on any failure):

| Method | Notes |
| --- | --- |
| `llm`, `tts`, `asr`, `imageGen` | as before; `asr` takes an audio **ref**, never raw audio |
| `extractMemory({ transcript, allowedKeys, promptVersion, studentId, stageId })` | **validate returned key against `allowedKeys` (lesson `declaredMemoryKeys`)**; invalid → `null` + trace, never a classroom failure (Codex #6) |

Pipeline: prompt from versioned git template → input safety → token budget → `ProviderAdapter`
→ output safety → fallback (timeout/fail/filtered/schema miss) → audit via `TraceSink`. Output
validated (Zod) at the boundary. `AiMeta` (source/degraded/promptVersion) stays **server-side**.

## 2. Fake provider simulation harness — M2a

Upgrade `FakeProvider` to honor `FakeProviderConfig` (latency/fail/timeout/filteredOutput) +
async image (submit→poll w/ injected delay) + deterministic content + scenario presets.

## 3. Interaction model (contracts-v1.3) — M2b

**`INTERACT` ClientMessage** (interaction input; carries `interactionId` for idempotency):
```
INTERACT { studentId; stageId; interactionId; variantId?; input: InteractionInput }
InteractionInput =
  | voice{ audioRef }              // icebreak, talent follow-up answer
  | doodle{ doodleRef }            // shape A-line
  | answers{ answersByQuestionId } // shape B-line dialogue
  | talentOption{ option }         // talent pick
  | talentAnswer{ option?; audioRef }
  | playPrepared{ preparedId; outputKind }  // birth: play the pre-generated speech
```
**`STAGE_COMPLETE` cleaned** (Codex #3): payload = `selection | variantChoice | done` only —
remove `voice/doodle/interaction` (those are now INTERACT). STAGE_COMPLETE = choice/finish.

**`CALL_INTERACTION` carries the input** (Codex #1): add `interactionId` + the same
`InteractionInput` (today it only has ids — loses the actual input).

## 4. Async lifecycle (Codex #2 — pending + stale-protection)

```
INTERACT → reducer validates (current stage, etc.) → persists a PENDING interaction
  → emits CALL_INTERACTION → InteractionRunner calls the gateway (slow)
  → on completion: re-enter store.update, verify the interaction is still pending AND the
    stage hasn't advanced; if stale/duplicate → TRACE + drop (do NOT emit to the child);
    else mark done idempotently, persist, emit AI_OUTPUT, reduce INTERACTION_DONE{degraded}
  → timeout/failure → synthesize a fallback ClientAiOutput AND still INTERACTION_DONE{degraded:true}
```
- `StudentRuntimeState` gains a **pending-interactions** map (interactionId → {stageId,…}) so
  completions are idempotent and stage-checked.
- "AI thinking" is the window between INTERACT and AI_OUTPUT; `AI_READY` (extended below) signals
  pre-generated content is ready.

## 5. Delivery (contracts-v1.3)

- **`AI_OUTPUT`** carries a **child-renderable union, NOT `AiResult`** (Codex #4):
  `AI_OUTPUT { studentId; stageId; interactionId; output: ClientAiOutput }`,
  `ClientAiOutput = { text?; audioUrl?; imageUrls? }`. `AiMeta` stays in traces +
  `INTERACTION_DONE.degraded`.
- **`AI_READY`** extended (Codex #5): `{ studentId; stageId; interactionId|preparedId; outputKind }`.
- **Projection** (Codex #5): `REQUEST_PROJECTION` is currently ignored, but the lesson projects
  a child's birth certificate to the big screen. Add a `PROJECT` ServerMessage (to a
  teacher/projection audience) carrying the renderable payload. In v1.3 now.

## contracts-v1.3 change set

`INTERACT` + `InteractionInput`; `CALL_INTERACTION` += interactionId + input; `StageCompletePayload`
→ {selection,variantChoice,done}; `AI_OUTPUT` + `ClientAiOutput`; `AI_READY` += outputKind +
interactionId/preparedId; `PROJECT` message; `StudentRuntimeState` += pending interactions;
`extractMemory` signature += allowedKeys.

## Split

- **M2a (GO now):** gateway capabilities + pipeline + fake harness + output validation +
  fallback + `extractMemory(allowedKeys)`. Unit-testable; no contract changes.
- **M2b (after contracts-v1.3 is applied + reviewed):** the v1.3 contracts above +
  InteractionRunner (pending lifecycle) + reducer `INTERACT`→`CALL_INTERACTION` +
  completion→`INTERACTION_DONE` + projection + e2e (icebreak voice round-trip on fakes).

## Decisions (confirmed, corrected per Codex)

1. **`INTERACT`: yes** — with `interactionId` + the full Lesson-1 input union; remove interaction payloads from `STAGE_COMPLETE`.
2. **`AI_OUTPUT` child-renderable only: yes** (not `AiResult`).
3. **Split M2a→M2b: yes** — M2a now; M2b after the P0 contract/lifecycle fixes above are in the contracts.
