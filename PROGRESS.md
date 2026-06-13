# PROGRESS

## Last updated

2026-06-11 (development RESUMED; Step-4 deferred review completed — all findings fixed)

## Current state

**M4d ✅, Architecture v2.0 ✅, Phase 1 ✅ (persistent identity), Phase 2 ✅ (student workspace)**

Complete 6-stage classroom flow (intro → icebreak → shape → talent → birth → closure) validated.
Multi-role real-time collaboration (student/assistant/teacher) verified. Technical architecture
and product vision validated. **Forward-looking scalable architecture designed** to support
student-centric persistent workspaces, AI agents with long-term memory, parent co-working,
tool-calling framework, rich media, and multi-city deployment.

### Completed milestones (MVP - Classroom-centric)

- **M1** — Config-driven state machine + Reducer + Zod validator + Socket.IO sync + atomic SessionStore + Resume
- **E-M1** — End-to-end smoke test (intro→closure + reconnect)
- **M2a** — AI Gateway core: `llm/tts/asr/imageGen/extractMemory` pipeline (input safety → timeout → output validation → degradation, never throws), FakeProvider + fault injection, audit seam (real Tencent IMS/TMS = M6)
- **M2b** — contracts-v1.3 (`INTERACT`/`AI_OUTPUT`/`PROJECT`/`pending`; idempotent interaction, stale rejection, session lock-free execution)
- **M3** — Frontend complete (React + Vite):
  - Student: 6 stages (Standby/Intro/Icebreak/Shape/Talent/Birth/Closure)
  - Assistant: classroom creation, status view, stage unlock
  - Teacher: projection screen, roster
  - WebSocket real-time sync + reconnect (5 retries)
  - Canvas doodle, voice input, image selection
- **M4a** — contracts-v1.4 + server (talent memory extraction, birth pre-generation, projection auth)
- **M4b** — Frontend Talent/Birth/Closure + teacher projection screen
- **M4c** — Assistant registration (`role=assistant` → `assistantId`)
- **M4d** — Force advance UI (FORCE_ADVANCE button + confirmation flow)
- **Architecture v2.0** — Scalable architecture designed (1,344 lines): student-centric persistent workspaces, AI agents with long-term memory, parent co-working, tool-calling framework, rich media pipeline, multi-city deployment

### Test coverage

✅ **Unit tests** (453 total, all green):
- ai-gateway: 44
- server: 303 (PGlite migration/runner/preflight gates + identity/workspace/IP-character/
  agent-context/reflection/parent/playground suites + the full-loop e2e: enroll → join →
  real interactions → memory mining → closure → profile + PORTFOLIO read over HTTP)
- web: 106 (classroom stages + shell/theme + parent H5 + playground world)

✅ **E2E tests**:
- Single student: `tools/demo-e2e-test.mjs`
- Multi-student concurrent: `tools/demo-e2e-multi-student.mjs` (3 students join, state sync, gate validation)

✅ **Environment validation**:
- WSL2 + Windows + global VPN verified
- CORS cross-origin configured
- Port forwarding + VPN split tunnel documented

### Known issues & technical debt

The live ledger is [`docs/DEFERRED.md`](docs/DEFERRED.md) (every deferral has an explicit
replacement trigger). The MVP-era issue list is archived at
[`docs/archive/known-issues.md`](docs/archive/known-issues.md) (most items resolved by
later milestones).

---

## Scalable Architecture v2.0 Roadmap (Phase 1-8)

**Target**: Student-centric persistent workspaces, AI agents that co-evolve with children,
parent co-working, tool-calling framework, rich media, multi-city deployment.

**Full design**: `docs/architecture/scalable-architecture-v2.md`

### Architecture shifts

**From (MVP):**
- Classroom-centric ephemeral sessions
- Students join with room codes → ephemeral `studentId`
- Session state in Redis → lost after class
- AI interactions serve lesson flow, not persistent agent

**To (v2.0):**
- Student-centric persistent identity (parent enrollment before class)
- Personal workspaces: works, interactions, memories persist
- AI agents remember and co-evolve across lessons
- Parents view and co-work with children after class
- Tool-calling: children discover/call tools to create IPs
- Rich media: images, videos, 3D printable models, physical souvenirs
- Multi-city: 20-30 students per classroom (premium 1:5 assistant ratio), distributed across cities, cloud-native scale

### Phase roadmap

| Phase | Focus | Duration | Status |
| --- | --- | --- | --- |
| **Phase 0** | Architecture design | 1 week | ✅ Complete |
| **Phase 1** | Persistent identity & enrollment | 2-3 weeks | ✅ Complete (2026-06-09) |
| **Phase 2** | Student workspace foundation | 3-4 weeks | ✅ Complete (2026-06-09) |
| **Phase 3** | Parent read-only artifact | 2 weeks | ✅ Complete (2026-06-09) |
| **Phase 4** | Agent service with memory — **scope expanded** (2026-06-09): cross-lesson memory + in-scene multi-round running context (hot/cold split) + episodic memory kind + operational floor (concurrency, cost counters, safety holes) | 4-5 weeks | ✅ Complete (2026-06-10) |
| **Phase 4.5** | **IP character entity & versioning**: canon record (layered model), work lineage, works-lifecycle + parent-curation amendment | 1-2 weeks | ✅ Complete (2026-06-10) |
| **Phase 5** | Tool registry & tool-calling — tools = in-scene creation instruments; brand-style slice live since P4 | 3-4 weeks | ✅ Complete (2026-06-10) |
| **Phase 6** | Parent co-working — server slice (auth + timeline + notes) + parent H5 (token-gated home) | 3 weeks | ✅ Complete (2026-06-10; SMS/WeChat mint = later, behind the frozen verifier seam) |
| **Phase 6.5 (APP integration)** | ONE APP (founder pivot 2026-06-10, PRD v0.2 §10): contracts (world/theme/agent-session) → Shell refactor (+ one-tap classroom entry DF-v2-26) → 乐园 v0 zero-AI floor → parent unlock door → L1 reflection/diary → companion-conduct CI | 6-8 weeks | 🔄 Steps 1-4 / 6 delivered (2026-06-12); next = parent panel DF-v2-28 |
| **Phase 7** | Rich media pipeline + real providers (narrowed: async media + video/3D + style-conformance; brand slice moved to P5) | 4-5 weeks | 📋 Deferred behind APP integration (founder 2026-06-10; external credentials still pending) |
| **Phase 8** | Multi-city deployment | 2-3 weeks | 📋 Planned |

**Total estimated**: ~6-7 months for full architecture (Phases 1-8; +2-3 weeks from the
2026-06-09 IP-concept realignment — see
[`docs/product/ip-character-concept-decisions.md`](docs/product/ip-character-concept-decisions.md)).

**Anchor reframe (2026-06-09, founder-ratified)**: the development anchor is the
**evolving personal IP character** (the child's AI friend, continuously refined across
lessons, brand-recognizable); the birth certificate remains lesson-001's ritual =
the IP character's v1.0 snapshot. All decisions + design principles (AI-first schema
validation, layered IP model, broad instrumentation without scoring, premium-over-cost)
are recorded in `docs/product/ip-character-concept-decisions.md`.

**Critical path**: Phases 1-3 (identity + workspace + parent) make parent feature scalable.
Phases 4-8 are incremental expansions.

### New service boundaries (modular monolith → microservices evolution)

| Service | Responsibility | Initial location | Extract trigger |
| --- | --- | --- | --- |
| Identity | Student/parent enrollment, auth, tenant | `apps/server/src/identity` | Multi-team ownership |
| Classroom | Real-time WebSocket sync (current MVP) | `apps/server` (unchanged) | N/A |
| Workspace | Persistent portfolio, HTTP REST | `apps/server/src/workspace` | 100+ concurrent classrooms |
| Agent | Memory management, context building | `apps/server/src/agent` | CPU-intensive workload |
| Content | Async media pipeline, object storage | `apps/server/src/content` | I/O-bound bottleneck |
| AI Gateway | Extended: tool dispatch, memory prompts | `packages/ai-gateway` (extended) | N/A |

### Storage architecture

| Tier | Technology | Purpose |
| --- | --- | --- |
| **Redis** | Current + extensions | Hot classroom state, agent short-term memory, TTS cache |
| **PostgreSQL** | New (Phase 1+) | Student profiles, workspaces, long-term memories, tool registry |
| **Object Storage** | New (Phase 2+) | Tencent COS: all media with CDN delivery |
| **Vector DB** | Optional (Phase 4+) | pgvector or Pinecone: semantic memory search if workspace grows large |

---

## Contracts

The authoritative index with per-contract versions is
[`docs/contracts/README.md`](docs/contracts/README.md). Snapshot (2026-06-12): **16
frozen contracts** —
identity **v1.1** · enrollment **v1.1** · workspace **v1.4** · parent-share **v1.5** ·
parent-surface **v1.2** · agent-context **v1** (+D1 ruling) · ip-character **v1** ·
scene **v1** · tool **v1** · brand-style **v0.1** · agent-session **v1.2** · world **v1.2** ·
theme **v1** · course-engine / client-server / ai-gateway / safety / data-and-privacy v1/v0.
(`content.md` for the Phase-7 media pipeline is the one not-yet-authored contract.)

---

## Development environment

macOS (current). PostgreSQL 16 + Redis via `docker compose`. The historical
WSL2/Windows/VPN setup and the completed Mac migration record are archived under
[`docs/archive/`](docs/archive/).

---

## Documentation status

Full documentation map: [`docs/README.md`](docs/README.md). Key living docs —
product anchor [`docs/product/ip-character-concept-decisions.md`](docs/product/ip-character-concept-decisions.md),
latest blueprint [`docs/product/genius-x-app-prd-draft.md`](docs/product/genius-x-app-prd-draft.md),
contract index [`docs/contracts/README.md`](docs/contracts/README.md),
deferrals [`docs/DEFERRED.md`](docs/DEFERRED.md),
collaboration protocol [`AGENTS.md`](AGENTS.md). Historical artifacts archived under
[`docs/archive/`](docs/archive/).

---

## Phase 1 progress (Identity & Enrollment — 7 steps, see PHANDBOOK)

1. ✅ **Step 1: Contracts frozen v1** (2026-06-09) — `identity.ts`/`enrollment.ts` typed,
   `identity.md`/`enrollment.md` prose, `ClassSession.tenantId` added, `SessionJoinRequest.studentId`
   added, 4-lens adversarial review (1 blocker + 3 majors fixed) + independent re-verification.
   Lead-ratified decisions: ClassSession carries tenantId; POST /parents idempotent;
   join-rejection renders warm to the child (Agent B), loud to operators.
2. ✅ **Step 2: PostgreSQL schema applied** (2026-06-09) — migration 001 + demo-tenant seed
   (4 students), checksum-guarded migrate runner (`migrate`/`migrate:seed`), pooled pg client,
   22 PGlite tests as permanent preflight gate; applied + verified on real postgres:16 (compose).
   Review fixes: NULL-safe capacity CHECK, guardianship composite FK, checksum journal,
   pool error listener, production seed guard.
3. ✅ **Step 3: Identity Service implemented** (2026-06-09) — `IdentityService` (7 methods:
   idempotent createParent w/ identifier reconciliation, atomic CTE enrollStudent, getStudent,
   allowlisted updateStudent, overwrite updateConsent, server-internal applyProgressUpdate,
   cursor-paginated listTenantStudents) + `IdentityServiceError`/`IDENTITY_ERROR_STATUS`;
   59 PGlite tests (unit + e2e flows); real-PG16 smoke via pg.Pool; adversarial review
   (probe-verified) — 1 major (partial-identifier silent drop → backfill + operator log)
   + 7 minors + 7 nits all fixed. Step-4 zod schemas pre-staged (`schemas.ts`).
4. ✅ **Step 4: HTTP API live** (2026-06-09) — six frozen endpoints (`routes.ts`) + zod
   wire-shape boundary (`schemas.ts`, strictObject privilege rejection) + error discipline
   (registry mapping; `setErrorHandler` backstop: parser failures → 400 INVALID_INPUT,
   anything escaped → sanitized 500, never err.message/PII on the wire); composition root
   wires pool from DATABASE_URL with boot preflight (fatal in live/production) + graceful
   shutdown + configurable CORS_ORIGIN. Real-PG16 HTTP smoke green. Adversarial review
   (probe-verified): 2 majors (parser bypass, PII leak channel) + 5 minors + 3 nits all fixed.
   enrollment.md v1.1: off-registry 500 note (lead-serialized).
5. ✅ **Step 5: Classroom join → persistent studentId** (2026-06-09) — student joins now
   LOOKUP (never mint): studentId required → identity lookup → 400/404/403/503, displayName
   from the profile (client name ignored), idempotent re-join (state kept, name refreshed),
   rejected joins persist nothing. WS HELLO resume DENIES unknown students (the ephemeral
   backdoor is closed; `join_rejected` traces count every refusal — contracts TraceEvent
   +kind, lead-serialized). TENANT_ID fail-closed + value-preflighted in live/production;
   pg query_timeout bounds the join path. Web: enrollment-link join (?studentId=), warm
   child-facing rejection (pinned by JoinScreen tests + banned-wording scan). Demo scripts
   + demo-start.sh migrated to seeded students. Adversarial review: 1 blocker (WS phantom
   mint) + 4 majors + 5 minors + 2 nits all fixed. Real-PG16 join smoke green.
6. ✅ **Step 6: End-to-end validated** (2026-06-09) — classroom→profile WRITE-BACK at lesson
   end (`recordLessonCompletion`: atomic + idempotent; fire-and-forget, never blocks the
   classroom, failures = operator traces only). `identity-classroom.e2e.test.ts`: enroll →
   join → full lesson over real HTTP+WS → profile persists (completedLessonIds + avatar) +
   write-back failure isolation. Admin tool `tools/enroll-student.mjs` (prints enrollment
   links; sibling enrollment reuses the parent). Real-PG smokes green.
7. ✅ **Step 7: Docs & cleanup** (2026-06-09) — `docs/migration/mvp-to-phase1.md` (operator
   runbook + failure modes), DF-v2-1 resolved, debug logs swept (guards.ts), full suite green.

---

## Known technical debt (managed, not blocking)

See `docs/DEFERRED.md` for the full ledger.

Key items:
- DF-1: AI providers still `FakeProvider` (M6 swaps to real Tencent)
- DF-2: Image moderation seam present, real 天御 IMS deferred (M6)
- DF-6: In-process session mutex (scale-out needs Redis lock/CAS)
- DF-7: Course authoring hand-authored (Payload CMS shadow)
- DF-8: Auth/RBAC lightweight (Better Auth shadow)
- DF-M3-7: UI/UX functional-first (full visual design pass needed)
- DF-M4-5: Birth certificate not persisted (Phase 3 addresses)

All shadow systems remain pluggable and will not block classroom runtime per AGENTS.md rules.

---

_Last milestone: PHASE 2 COMPLETE — student workspace (contracts → schema 002 → service/API → per-stage classroom writes → e2e)_
**Phase 3 delivered** (2026-06-09, branch `phase3/parent-share`): capability-token share
(256-bit, hash-only storage, 90-day expiry, uniform 404), lesson-end auto-mint with
operator notification seam (console default; WeChat sink = seam-ready, needs 资质),
privacy-filtered `GET /share/:token` (DENY-list serialization-pinned + deep contentJson
scrub), parent H5 (`?share=` route: certificate hero + works gallery + warm empty/failure
states), operator tool `tools/parent-link.mjs`, expiry+30d retention sweep, BINDING
deployment exposure rule (proxy allowlist; DF-v2-16 = process-enforced split). Adversarial
security review: 1 blocker + 4 majors + 7 minors + 4 nits — ALL confirmed findings fixed
with tests (202 server / 63 web green; real-PG16 smoke green).

**Phase 4 delivered** (2026-06-10, PRs #18-#22): the companion REMEMBERS — in-scene
(turn buffer: round 2 carries round 1, hot path), across scenes (episodic consolidation:
each scene becomes ONE schema-valid memory — the AI-first carve-out), and across lessons
(cold path: canon + latest-per-key semantic memories + episodes ride every conversational
call as the versioned context_v1 block). Plus the operational floor: round caps enforced
with the friend's warm wrap-up (decision ⑦), per-gateway concurrency gate (DF-v2-19),
scene round counters (decision ⑥), per-child seeded fallback rotation, brand style-v0
gateway injection (DF-v2-18 placeholder), safety parity (extractMemory/Episode output
review, interactions.safety column, pre-submit image input review). Contracts:
agent-context.md v1 (+Step 2-5 annotations), ip-character.md v1, brand-style.md v0,
workspace.md v1.1, parent-share.md v1.2. Five adversarial review rounds; every confirmed
finding fixed with tests (355 green; migrations 001-004 on real PG16).

**Phase 4.5 delivered** (2026-06-10, PRs #23-#24): the IP character is a versioned DATA
ENTITY — locked base canon + child-refined surface, every refinement an immutable
snapshot (the growth timeline); lesson end creates the v1 birth snapshot / refines a
version with idempotent retries; the GeniusXProfile mirror is SINGLE-writer (both legacy
writers cut over, projected fields fail closed); works carry character-version lineage
(read-path surfaced, failures countable); the agent's canon source reads the entity
(mirror fallback, same seam); works lifecycle = one Work per completion EVENT with
parent-side curation (latest-per-type finals + 打磨轨迹 slices — decision ②'s coupling
honored). Review blocker fixed: deterministic latest-per-type via works.seq.

**Phase 5 delivered** (2026-06-10, PR #25): scene.md v1 (scene==stage formalized; scene
LIBRARY + in-class selection via declared successors — decision ⑤ option 2; exactly-one-
terminal completion; linear lessons untouched; assistant panel renders one button per
successor) + tool.md v1 (closed gateway-bound mechanics — tools can never name an
endpoint; brand composition rule; no free text into prompts; provenance = the interaction
record). First real tool: 魔法画笔 (image_refine) — the iterative aesthetics loop: own-work
ownership validated, declared options only, img2img guidance styled with the brand suffix,
enforced image-scene round caps (warm wrap-up), every denial countable + warm-redirected.

**Phase 6 server slice delivered** (2026-06-10): parent-surface.md v1 (frozen) — the
parent's AUTHENTICATED home. Auth = the proven Phase-3 capability machinery, parent-scoped
(sha256-hash-only tokens, 180-day expiry, uniform 404 everywhere — unknown token = expired
= not-your-child, no oracle; SMS/WeChat login replaces the operator mint later behind the
same verifier seam). Reads: children list (companion SURFACE), the growth timeline
(ip_character_versions surface-only projection ⋈ lineage works), full works history (the
parent-share DENY discipline extends — no transcripts/episodes/operator metadata/
base_canon). Co-working v1 = the parent note: safety-reviewed BEFORE storage, ≤3 pending
per child, relayed by the companion EXACTLY ONCE via the 【爸爸妈妈想对你说】 context section
(CONTEXT_VERSION → context_v2), relay failures countable and never blocking the lesson.
Adversarial review (2 confirmed majors, both fixed): the exposure rule serialized into
parent-share.md v1.4 (cross-contract consistency — a deploy following either contract now
agrees); relay marks moved to the CONTROLLER after a NON-DEGRADED reply (build-time
marking silently lost notes under gateway fallback). Migration 006; 394 tests green; 006
smoked on real PG16.

**Phase 6 Step 3 delivered** (2026-06-10): the parent H5 — token-gated home
(`?parent=<token>`): children cards (companion surface), the growth timeline (诞生时刻 →
第 N 次成长, lineage works), and the note composer (gentle full lifecycle). Adversarial
review major: the 180-day all-children write-capable token must not inherit the share
token's history-persistence acceptance — contract v1.1 pins **scrub-on-mount** (token
captured into memory, value scrubbed from the address bar) + the no-referrer meta as
binding preconditions; mid-session dead tokens (uniform 404) now show re-request guidance
on every surface, never misleading retry/rewording copy. 408 tests green.

**Phase 6.5 Step 2 delivered** (2026-06-10): the Shell — `resolveEntry` owns URL→entry
(all legacy aliases + precedence pinned by tests); ThemeProvider applies ThemePackV1
tokens as `--gx-*` CSS custom properties (theme.md realization in `@genius-x/contracts`:
closed-schema manual parse, THEME_FLOORS_V0 with fail-closed contrast/wrap-band hue
checks, BRAND_DEFAULT_THEME; invalid/floor-crossing/expired-skin packs NEVER render —
brand default applies); styles.css tokenized (gx tokens + legacy aliases — zero visual
change, classroom suites untouched and green). Review minors all fixed (prototype-
smuggle guard, degenerate-value rejections, achromatic hue exemption); DF-v2-27 records
the countable-trace + loader-seam obligations for when non-default packs ship.

**Phase 6.5 Step 3 delivered** (2026-06-10): 乐园 v0 + the unlock door. Server: migration
008 (`playground_session_tokens` — hash-only, composite student FK, 35-min TTL CHECK,
DB-enforced ONE-active via UNIQUE partial index); PlaygroundService (curfew + DAILY
quota mint-enforced from token history — the v1.1 interim; uniform 404; one-read
worldView with DENY); routes (`GET /playground/world` header-token-only = the third
internet-facing family; the mint = parent-surface v1.2's second parent write,
409 COMPANION_ASLEEP/RESTING via structural error). Web: PlaygroundApp (scrub-on-mount,
server-anchored sleepy wind-down filling the grace window, 盖被子 ritual, client-cached
asleep scene — a dead session NEVER shows error copy), world registry per world.md v1.1
(doc-parsing key check, real export scan, import ban, rendered-output banned-wording on
every state), parent 「把屏幕交给孩子」 door. Review: 3 confirmed majors + 13 low — ALL
fixed (contracts v1.1 both). 445 tests; PG16 smoked. Gate ⑤ honored: v0 reads only.

**Phase 6.5 Step 4 delivered** (2026-06-11): L1 reflection — the companion diary
(DETERMINISTIC tier: composed from the session's reviewed episode summaries + works
count, no model call — the honest FakeProvider-era form; generative diary arrives with
real LLM via the same seam). `self_narrative` reserved kind (workspace.md v1.3 carve-out:
schema-valid `DiaryEntryValue` only, never lesson-declarable, EXCLUDED from semantic
context retrieval — a diary must never silently change the versioned cold block);
ReflectionService fires at lesson end AFTER consolidations settle (idempotent per
student×lesson; no episodes ⇒ honest absence, traced); the playground worldView serves
摊开的日记 (top 5) + the L1 visit greeting (newest episode → 「…——我还想着呢！」);
world.md `companion_diary` object shipped. 450 tests green. NOTE: the customary
adversarial review round for this slice is DEFERRED to development resumption
(founder paused development 2026-06-11 for a progress report).

**DEVELOPMENT RESUMED** (founder, 2026-06-11). **Step-4 deferred review completed and
ALL findings fixed** (4 confirmed majors + 11 low): lesson validator now rejects
`self_narrative` declarations (the one hole letting the extraction path mint
MODEL-AUTHORED diary entries served to the child — closed, tested); diary idempotency
DB-ENFORCED (migration 009 partial unique index; probe-proven concurrent-write race
closed); `memories.seq` added (the works.seq tie fix extended to greeting/diary/episode
reads); `world_diary_malformed` serialized into world.md v1.2's closed taxonomy + the CI
subset test widened beyond prefix filtering; greeting cold-miss semantics pinned
(agent-session v1.2); truncation sentence-bounded + counted; madeCount = curated
DISTINCT-type count; diary wire shape pinned; UTC date bug fixed (Asia/Shanghai).
workspace.md → v1.4. 453 tests; 009 smoked on real PG16.

_Next: parent panel (DF-v2-28 — quota settings: tenants.config playground key +
playground_settings, most-restrictive fail-closed) → 心愿种子 co-creation. Gate ⑤ still
blocks playground writes. Pending external: brand doc (DF-v2-18), 微信资质 (Q7 —
calendar risk), decision ③._
