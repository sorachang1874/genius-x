# System Interaction Map

How the modules call each other and what crosses each boundary. Pairs with the per-module
boundary contracts in `docs/contracts/`. All shared types come from `@genius-x/contracts`.

## Module dependency graph

```
apps/web (A student / B assistant)
   │  ClientMessage / ServerMessage (WS) + HTTP join   ── client-server.md
   ▼
apps/server  (C: XState stage machine + Socket.IO)     ── course-engine.md
   │  capability calls (llm/tts/asr/imageGen/extractMemory/birthSpeech)
   ▼
packages/ai-gateway (D: safety→budget→route→fallback)  ── ai-gateway.md, safety.md
   │  ProviderAdapter
   ▼
providers: FakeProvider (scripted) | Tencent (live)    ── providers/README.md

Shared (read-only): @genius-x/contracts (types) · @genius-x/course-config (lesson001)
Shadow (pluggable): Payload CMS · Better Auth · Langfuse(TraceSink) · promptfoo
Persistence: Redis (live ClassSession) · Postgres (archived profiles/artifacts)
```

**Overlaps / ownership boundaries:**
- Only **C** calls **D**; **A/B** never call **D** directly (no AI in the client).
- Only **D** talks to providers + moderation; **C** never calls a provider.
- **A/B ↔ C** is purely `@genius-x/contracts` ws-events — no shared code, no drift.
- Every module imports contracts **read-only**.

## Flow 1 — Stage unlock (assistant → all students)

```
B assistant ──ASSISTANT_UNLOCK(stageId)──▶ C
C: stage machine transition (XState) + persist currentStage
C ──STAGE_UNLOCK(stageId)──▶ all A students   (SLO ≤500ms)
A: render the unlocked stage
```

## Flow 2 — Voice icebreak (AI round-trip, PRD §7.2)

```
A ──STAGE_COMPLETE(audioRef)──▶ C
C ─ gateway.asr(ref) ─▶ D ─(safety in→route→safety out)─▶ AsrResult(transcript)
C ─ gateway.llm(icebreak_v1, transcript) ─▶ D ─▶ LlmTextResult(text, meta)
C ─ gateway.tts(text) ─▶ D ─▶ TtsResult(audioUrl)
C ──(reply payload)──▶ A   ; A plays audio + thinking animation
If any D call breaches budget/fails → D returns fallback(degraded:true, logged); C proceeds.
```

## Flow 3 — Shape / image gen (async, PRD §7.3, A-line)

```
A ──STAGE_COMPLETE(doodleRef)──▶ C
C ─ gateway.imageGen(img2img, doodleRef, count=3) ─▶ D
   D: provider.imageSubmit → job ; provider.imagePoll → ImageGenResult
   D: 天御 IMS moderation BEFORE returning ; (SLO ≤15s else preset fallback)
C ──(3 candidate images)──▶ A ; child selects → STAGE_COMPLETE(avatarUrl)
C: persist geniusX.avatarUrl
```

## Flow 4 — Talent + memory (background extraction, PRD §7.4)

```
A picks a talent ──STAGE_COMPLETE(audioRef)──▶ C
C ─ gateway.asr ─▶ transcript ; C ─ gateway.<talent output> ─▶ content
C ─ gateway.extractMemory(transcript) ─▶ MemoryExtraction{key,value}  (background)
C: append Memory to profile (data-and-privacy: transcript ok, raw audio discarded)
```

## Flow 5 — Birth (pre-generated, PRD §7.5)

```
B unlocks birth ──▶ C
C ─ gateway.birthSpeech(profile) ─▶ LlmTextResult ; gateway.tts ─▶ audio   (async, pre-gen)
C ──AI_READY(studentId)──▶ A   when ready
child taps play ──▶ A plays speech ; C builds BirthCertificate (avatar+tag+memories+speech)
```

## Flow 6 — Closure (global, PRD §7.6)

```
teacher (via B) ──▶ C
C ──GLOBAL_STATE("closure")──▶ all A   ; A switches to summary + birth cert
```

## Reconnect (cross-cutting)

```
A (re)connects ──HELLO(studentId)──▶ C ──RESUME_STATE(currentStage, global)──▶ A
```
