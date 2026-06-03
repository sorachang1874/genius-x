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
| DF-3 | Memory extraction in talent | deferred-feature | gateway `extractMemory` exists but not called from talent flow | wire into talent interaction | needed for Lesson-1-complete (birth cert uses memories) | C/D · **M4** |
| DF-4 | Birth pre-generation + `playPrepared` + `AI_READY{preparedId,outputKind}` | deferred-feature | removed `playPrepared` from `InteractionInput`; AI_READY marked M4 | birth stage build | re-add to contracts (v1.x) when birth lands | C/D · **M4** |
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
| DF-M3-8 | Assistant advance controls | partial | assistant panel emits `ASSISTANT_UNLOCK`/`TEACHER_UNLOCK` for the next stage (role read from lesson config); **`FORCE_ADVANCE` not surfaced** — the engine requires `assistantId ∈ session.assistants`, which `/session/join` does not populate yet | register assistants on join (or an assistant-join endpoint) + add the override button | one straggler can't yet be force-advanced from the UI |
| DF-M3-9 | Client-side degradation telemetry | placeholder | client degradations (audio→speech fallback, mic-denied) call an `onDegraded` seam → default `console.warn("[client-degraded] …")` (operator-visible, greppable) | real client telemetry sink (post to a `/client-trace` endpoint / Langfuse) | keeps the degradation principle honest on the client until a real sink lands |

## Review log

- 2026-06-03 — ledger created; seeded from M1/M2 deferrals.
