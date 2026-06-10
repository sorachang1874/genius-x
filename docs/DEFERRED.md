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
| DF-5 | ~~`REQUEST_PROJECTION` → teacher big-screen~~ | **✅ RESOLVED (M4a/M4b)** | Implemented: assistant-gated projection validated under the mutex + teacher screen shipped | — | see DF-M4-4 | A/C · ✅ |
| DF-6 | Session mutex (concurrency) | temp-fallback | in-process `KeyedMutex` (single server instance only) | multi-instance deploy | replace with Redis lock/CAS when >1 server instance | C · scale-out |
| DF-7 | Course authoring | shadow | hand-authored `lesson-001.ts` (git) | Payload CMS (`apps/cms`) | when authoring Lesson 2+; CMS export must conform to `LessonConfig` | F · fast-follow |
| DF-8 | Auth / RBAC | shadow | lightweight room-code/QR join; role from message type (trusted) | Better Auth | enforce connection-role verification when auth lands | F · fast-follow |
| DF-9 | Tracing / prompt eval | shadow | no-op/console `TraceSink`; prompts in git | Langfuse (async sink) + promptfoo | adopt when prompt iteration heats up; never a runtime dep | F · early |
| DF-10 | Parent end | **in-progress (Phase 3)** | Phase 3 delivers parent read-only H5 artifact; Phase 6 adds co-working | parent read-only artifact = Phase 3; parent co-working = Phase 6 | see scalable-architecture-v2.md §6 | K · **Phase 3/6** |
| DF-11 | Monorepo build cache | deferred-feature | pnpm workspaces only | Turborepo | when CI/builds drag | E · later |

## Scalable Architecture v2.0 deferrals (Phase 1+)

New deferrals for the student-centric persistent architecture. See `docs/architecture/scalable-architecture-v2.md`.

| ID | Item | Kind | What we do now | Replace / complete trigger | Notes |
| --- | --- | --- | --- | --- | --- |
| DF-v2-1 | ~~Persistent student identity~~ | **✅ RESOLVED (2026-06-09, Phase 1)** | Parent enrollment creates permanent `studentId`; classroom join + WS resume are lookup-only; lesson completion writes back to the profile | — | See `docs/migration/mvp-to-phase1.md` |
| DF-v2-2 | Student workspace | deferred-feature | Class artifacts lost after Redis expiry | Phase 2: PostgreSQL + object storage persistent workspace | Works, interactions, memories persist |
| DF-v2-3 | AI agent long-term memory | deferred-feature | No cross-lesson memory | Phase 4: agent service with importance-scored memories | Agent co-evolves with child |
| DF-v2-4 | Tool-calling framework | deferred-feature | No discoverable tools | Phase 5: tool registry + agent suggestions | Children call tools to create IPs |
| DF-v2-5 | Parent co-working | deferred-feature | No parent-initiated interactions | Phase 6: parent can interact with child's agent | WeChat miniapp + OAuth |
| DF-v2-6 | Rich media (video/3D) | deferred-feature | Images only | Phase 7: video generation, 3D models, async processing | Physical souvenirs (3D print) |
| DF-v2-7 | Multi-city tenant isolation | deferred-feature | Single deployment | Phase 8: tenant-aware queries, distributed locks | Data residency, 20-30 students/class (premium model) |
| DF-v2-8 | Service extraction | deferred-feature | Modular monolith | Extract services when 100+ concurrent classrooms | Workspace, agent, content services |
| DF-v2-9 | Vector DB semantic search | deferred-feature | Importance-scored list | pgvector or Pinecone when workspace grows large (100+ memories/student) | Optional optimization |
| DF-v2-10 | Physical souvenir ordering | deferred-feature | None | M7+: order service + fulfillment partner integration | 3D printed figurines, printed books |
| DF-v2-11 | `pg` version convergence (pnpm catalog) | deferred-infra | `pg`/`@types/pg`/PGlite declared only in `apps/server` (sole consumer; "who uses, declares") | A second Postgres consumer appears (e.g. extracted `apps/identity-service`, CMS direct-connect) → move shared versions to a pnpm catalog | PGlite is pure WASM (no postinstall) — no build-script allowlist needed |
| DF-v2-12 | Per-room/class tenant resolution | deferred-feature | ONE tenant per server process (`TENANT_ID`, fail-closed in live/production; demo default dev-only) | Multi-tenant single deployment: resolve the session's tenant from the room/class record at creation | Step-5 scoping decision; distinct from DF-v2-7 (Phase 8 multi-city infra) |
| DF-v2-13 | Write-back crash window (at-most-once) | deferred-hardening | Lesson-end profile write is fire-and-forget; a crash between the closure persist and the write loses it (no trace) | Phase 2: outbox/`writebackPending` flag persisted with the transition, re-fired on load | Recovery SQL documented in mvp-to-phase1.md |
| DF-v2-14 | Stage-level companion writes + output→profile map | deferred-feature | geniusX written once at lesson end; avatar key `avatarUrl` and birth_speech stage matching are lesson-001 couplings (absence traced); Phase 2 added per-stage WORKSPACE writes (stage.output → Work) | Declare a per-lesson output→profile/work-field map when Lesson 2+ diverges | Lead-serialized divergence from identity.md lifecycle (see mvp-to-phase1.md) |
| DF-v2-15 | Memory retrieval latest-per-key dedup | deferred-feature | Workspace keeps EVERY mined memory row (a re-tapped interaction can store the same key twice at equal importance); runtime keeps latest-per-key | Phase 4 agent context building must dedup latest-per-key (or score) before consuming `listMemories` | Round-2 review note — duplicate rows are contract-accepted in Phase 2 |
| DF-v2-16 | Process-enforced public/operator listener split | deferred-hardening | ONE Fastify listener serves both postures; exposure enforced by route split (`registerPublicShareRoute` vs operator routes) + the BINDING proxy allowlist in parent-share.md (`GET /share/*` + static H5 only) | First internet-exposed deployment: add a second listener (`publicPort`) mounting ONLY the public share route, so the allowlist is process-enforced, not proxy-discipline-enforced | Phase-3 security review blocker resolution; deploy preflight in parent-share.md |
| DF-v2-17 | Right-to-erasure cascade path | deferred-feature | No `ON DELETE CASCADE` anywhere (002 pattern: works/interactions/memories; 003: share_tokens) — student deletion requires a manual ordered delete | A real erasure request / data-retention enforcement lands: scripted erasure path covering works, interactions, memories, **and share_tokens** (a forgotten share row would keep serving a deleted child's artifacts until expiry) | share_tokens expiry+30d purge IS implemented (boot sweep); this row is the per-student erasure path |

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
- 2026-06-08 — updated with Architecture v2.0 deferrals; DF-10 parent end now tracked as Phase 3/6.
