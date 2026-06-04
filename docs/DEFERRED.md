# Deferred & Temporary Ledger

Every **shadow system, placeholder, temporary fallback, or half-built seam** gets an entry
here with an explicit **replacement/deletion trigger** — so nothing is silently forgotten and
the project stays forward-looking + maintainable. Review this at every milestone. Nothing
ships as a permanent hidden shortcut (playbook: no hidden fallback; deletion gates).

Kind: `shadow` (pluggable platform) · `placeholder` (stands in for a real impl) ·
`temp-fallback` · `half-built` (seam present, impl partial) · `deferred-feature`.

| ID | Item | Kind | What we do now | Replace / complete trigger | Iterate / delete condition | Owner · target |
| --- | --- | --- | --- | --- | --- | --- |
| DF-1 | AI providers (LLM/TTS/ASR/image) | placeholder | `FakeProvider` behind `ProviderAdapter` (deterministic, no keys) | Tencent keys available **and** M6 | After swap, run a refinement pass on prompts/fallbacks/timeouts/corner-cases vs real output quality+latency; then delete fake from the live path (keep for scripted tests) | D · **M6** |
| DF-2 | Image moderation (天御 IMS) | half-built | `imageModerator` seam; absent ⇒ traces `moderation_deferred_m6` | inject real 天御 IMS moderator | required before any public/real-AI demo with children | D · **M6** |
| DF-3 | Memory extraction in talent | **resolved (M4a)** | talent voice/answer interactions mine a memory via `extractMemory` (reusing the runner's ASR transcript), written to `you.memories` (declared-key validated) | — | done in contracts-v1.4 + server | C/D · ✅ |
| DF-4 | Birth pre-generation + `playPrepared` + `AI_READY{preparedId,outputKind}` | **resolved (M4a)** | `playPrepared` back in `InteractionInput`; `AI_READY{preparedId,outputKind}` reshaped; birth pre-generates on settled memories (contracts-v1.4) | — | done | C/D · ✅ |
| DF-5 | `REQUEST_PROJECTION` → teacher big-screen | deferred-feature | controller returns early (no-op); `PROJECT` message defined | teacher-screen UI | wire when assistant/teacher projection is built | A/C · **M4/M5** |
| DF-6 | Session mutex (concurrency) | temp-fallback | in-process `KeyedMutex` (single server instance only) | multi-instance deploy | replace with Redis lock/CAS when >1 server instance | C · scale-out |
| DF-7 | Course authoring | shadow | hand-authored `lesson-001.ts` (git) | Payload CMS (`apps/cms`) | when authoring Lesson 2+; CMS export must conform to `LessonConfig` | F · fast-follow |
| DF-8 | Auth / RBAC | shadow | lightweight room-code/QR join; role from message type (trusted) | Better Auth | enforce connection-role verification when auth lands | F · fast-follow |
| DF-9 | Tracing / prompt eval | shadow | no-op/console `TraceSink`; prompts in git | Langfuse (async sink) + promptfoo | adopt when prompt iteration heats up; never a runtime dep | F · early |
| DF-10 | Parent end | deferred-feature | none | WeChat-optimized H5 | M5 | F · **M5** |
| DF-11 | Monorepo build cache | deferred-feature | pnpm workspaces only | Turborepo | when CI/builds drag | E · later |

## M3 (frontend) entries — add when M3 starts

| ID | Item | Kind | What we do now | Replace trigger | Notes |
| --- | --- | --- | --- | --- | --- |
| DF-M3-1 | TTS playback | placeholder | client speaks `AiOutput.text` via Web Speech API **only when `audioUrl` is absent/placeholder**; plays `audioUrl` when present | real TTS provides a real `audioUrl` (DF-1/M6) ⇒ **automatic** (client prefers audioUrl) | swap is server-side only; client already consumes `ClientAiOutput` |
| DF-M3-2 | Voice + doodle capture | placeholder | `getUserMedia`/`MediaRecorder` mic UX and native-canvas doodle, but `INTERACT(voice)`/`INTERACT(doodle)` send a **placeholder `audioRef`/`doodleRef`** (no upload — privacy contract: refs, never bytes) | real audio/image upload → COS + ref | wire upload when storage lands |
| DF-M3-3 | Candidate images | placeholder | `FakeProvider` returns bundled/`public` renderable URLs | real image provider returns real URLs (DF-1/M6) ⇒ **automatic** | client renders `imageUrls` as-is |
| DF-M3-4 | Role entry | placeholder | `?role=assistant` / selector | Better Auth role (DF-8) | demo convenience |
| DF-M3-5 | PWA / offline | deferred-feature | none (plain SPA) | vite-plugin-pwa service worker | add when classroom-offline reliability matters |
| DF-M3-6 | Clay figure + visual assets | placeholder | static placeholder art in `public/` (魔法泥人, candidate avatars) | final illustrated assets ready | B-level polish pass |
| DF-M3-7 | M3 UI/UX as a whole | half-built | functional-first interim: minimal native `<canvas>` doodle, placeholder avatars, plain visual style | **needs a full UX + visual design pass** | before any real classroom/B-level demo |
| DF-M3-8 | Assistant advance controls | **resolved (M4d)** | assistant panel emits `ASSISTANT_UNLOCK`/`TEACHER_UNLOCK` for the next stage (role read from lesson config); `FORCE_ADVANCE` button sends stageId/assistantId/reason/expectedCurrentStageId with confirmation UI | — | full feature complete: assistants register on join (M4c), `FORCE_ADVANCE` UI added (M4d) |
| DF-M3-9 | Client-side degradation telemetry | placeholder | client degradations (audio→speech fallback, mic-denied) call an `onDegraded` seam → default `console.warn("[client-degraded] …")` (operator-visible, greppable) | real client telemetry sink (post to a `/client-trace` endpoint / Langfuse) | keeps the degradation principle honest on the client until a real sink lands |

## M4 (talent / birth / closure / projection) entries

| ID | Item | Kind | What we do now | Replace trigger | Notes |
| --- | --- | --- | --- | --- | --- |
| DF-M4-1 | Birth speech TTS | placeholder | pre-gen produces a placeholder `audioUrl` via the fake gateway | real TTS provider (M6) ⇒ **automatic** (client prefers `audioUrl`) | swap is server-side only |
| DF-M4-2 | Talent 反问埋点 prompt tree | placeholder | `memory_v1`/`talent_v1` are simple versioned templates; extraction mines ≤1 memory/turn | a designed 4–5-option induction 话术树 (rundown 待确认) | prompt-design work, not engine |
| DF-M4-3 | personality_tag / background_setting | half-built | modelled as declared memory keys + config `certificate.memoryLabels`; background sourced from shape B-line when present, else talent | richer trait/background modelling if needed | certificate renders available labelled memories (no hard count) |
| DF-M4-4 | Teacher / projection screen | half-built | **server done** (M4a): `REQUEST_PROJECTION{requestedBy}` validated (control-surface + readiness) → `PROJECT`. Thin `?role=teacher` UI = M4b | richer multi-pad projection UX | single projected child, manual trigger |
| DF-M4-5 | Persisted `BirthCertificate` artifact | deferred-feature | live 伙伴出生证 assembled client-side from `RESUME_STATE.you` | archive/print/parent-report persistence = M5 | M4 ships the live view only |
| DF-M4-6 | GeniusX naming | deferred-feature | certificate name field may be blank | naming flow = Lesson 2 (D2 open) | — |
| DF-M4-7 | Projection role enforcement | **resolved (M4c)** | `requestedBy` must be a **registered assistant** (`∈ session.assistants`); student-origin/unknown ids denied + traced | — | assistants register on join with `role=assistant`; cryptographic role check via Better Auth (DF-8) deferred |

## Review log

- 2026-06-03 — ledger created; seeded from M1/M2 deferrals.
