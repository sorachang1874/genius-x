# PROGRESS

## Last updated

2026-06-09 (PHASE 2 COMPLETE: student workspace — works/interactions/memories persist)

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

✅ **Unit tests** (265 total):
- ai-gateway: 19/19
- server: 189/189 (PGlite migration/runner/preflight gates + identity suite + persistent-join
  suite + workspace suite + the full-loop e2e: enroll → join → real interactions → memory
  mining → closure → profile + PORTFOLIO read over HTTP)
- web: 57/57

✅ **E2E tests**:
- Single student: `tools/demo-e2e-test.mjs`
- Multi-student concurrent: `tools/demo-e2e-multi-student.mjs` (3 students join, state sync, gate validation)

✅ **Environment validation**:
- WSL2 + Windows + global VPN verified
- CORS cross-origin configured
- Port forwarding + VPN split tunnel documented

### Known issues (documented, not blocking demo)

See `docs/known-issues.md`:
- Assistant panel state incomplete (P2)
- Advance conditions not strictly enforced (P2)
- Placeholder image broken (P2)
- Fake TTS voice abrupt (P2, M6 resolves)

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
| **Phase 5** | Tool registry & tool-calling — tools = in-scene creation instruments; **absorbs brand-style slice** (style-v0 gateway injection BEFORE first tool-produced works) | 3-4 weeks | 📋 Planned |
| **Phase 6** | Parent co-working | 3 weeks | 📋 Planned |
| **Phase 7** | Rich media pipeline (narrowed: async media + video/3D + style-conformance checks; brand slice moved to P5) | 4-5 weeks | 📋 Planned |
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

## Contracts version

**Current**: v1.4 (MVP classroom-centric)
**Next**: v2.0 (Phase 1+ scalable architecture)

Key MVP changes:
- v1.0: Initial contracts
- v1.1: `TEACHER_UNLOCK`
- v1.2: `PreparedOutput` / `AI_READY`
- v1.3: `INTERACT` / `AI_OUTPUT` / `pending`
- v1.4: `displayName` / `memories` / `PREPARE_DONE` / `PROJECTION` auth

Phase 1+ contracts:
- `identity.md`: Student/parent persistent identity, tenant model — **frozen v1**
- `enrollment.md`: Enrollment API surface, error codes, join migration — **frozen v1**
- `workspace.md`: works/interactions/memories + read API — **frozen v1** (Phase 2)
- `parent-share.md`: capability-URL share + privacy DENY list + deployment exposure rule —
  **frozen v1.1** (Phase 3; v1.1 = security-review amendments, lead-serialized)
- `agent.md` / `tool.md` / `content.md`: planned — not yet authored

---

## Development environment

### WSL2 + Windows + VPN (current)

Resolved challenges:
- ✅ CORS cross-origin (@fastify/cors)
- ✅ Windows port forwarding (`tools/wsl-port-forward.ps1`)
- ✅ VPN split tunnel (`docs/vpn-split-tunnel-config.md`)
- ✅ WSL2 network setup (`docs/wsl2-setup.md`)

### Mac migration plan

See `docs/migration-wsl2-to-mac.md`:
- Environment setup: Homebrew, Node.js, pnpm
- Project clone and dependency install
- Validation checklist (typecheck, test, start services)
- Estimated time: 45-85 minutes

---

## Documentation status

### Product docs
- ✅ `docs/product/genius-x-manifesto.md` — Product vision
- ✅ `docs/product/genius-x-mvp-prd.md` — MVP requirements
- ✅ `docs/product/genius-x-lesson1-rundown.md` — Lesson 1 flow

### Architecture docs (new)
- ✅ `docs/architecture/scalable-architecture-v2.md` — Full scalable architecture design (1,344 lines)
- ✅ `docs/architecture/overview.md` — System overview (updated)
- ✅ `docs/architecture/lesson-runtime.md` — Lesson runtime patterns
- ✅ `docs/architecture/interaction-map.md` — Cross-module flows

### Technical docs
- ✅ `AGENTS.md` — AI agent collaboration rules (updated with Phase 1+ ownership map)
- ✅ `docs/contracts/README.md` — Contract registry (updated with Phase 1+ contracts)
- ✅ `docs/contracts/` — Boundary contracts (MVP + Phase 1 frozen; Phase 2+ planned)
- ✅ `docs/demo-live-guide.md` — Demo guide
- ✅ `docs/agents/README.md` — Multi-agent protocol
- ✅ `docs/DEFERRED.md` — Shadow systems and deferrals ledger

### Playbook integration
- ✅ Latest `ai-assisted-engineering-playbook` reviewed (commit `5228b8d`)
- ✅ New principles incorporated:
  - User-invisible fallback must stay operator-visible
  - Model output is a contract (prompt versioning, schema validation, records)
  - Independent review gates for design/implementation/adoption
  - Phase registry and artifact-first planning
  - Schema and storage before code

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

See `docs/known-issues.md` and `docs/DEFERRED.md` for full ledger.

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

_Next milestone: Phase 5 — tool registry & tool-calling (tools = in-scene creation
instruments; brand-style slice already live at the gateway). Pending external inputs:
brand/market design doc (replaces style-v0), team confirmation of decision ③._
