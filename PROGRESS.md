# PROGRESS

## Last updated

2026-06-09 (PHASE 1 COMPLETE: persistent identity & enrollment, all 7 steps)

## Current state

**M4d complete, Architecture v2.0 designed ✅, Phase 1 COMPLETE ✅ (persistent identity & enrollment)**

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

✅ **Unit tests** (231 total):
- ai-gateway: 19/19
- server: 155/155 (incl. 22 PGlite migration/runner tests + identity suite + persistent-join suite + the Phase-1 e2e (`identity-classroom.e2e.test.ts`) —
  the contract preflights, identity semantics, and HTTP error discipline as a permanent CI gate)
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
| **Phase 2** | Student workspace foundation | 3-4 weeks | 📋 Planned |
| **Phase 3** | Parent read-only artifact | 2 weeks | 📋 Planned |
| **Phase 4** | Agent service with memory | 4-5 weeks | 📋 Planned |
| **Phase 5** | Tool registry & tool-calling | 3-4 weeks | 📋 Planned |
| **Phase 6** | Parent co-working | 3 weeks | 📋 Planned |
| **Phase 7** | Rich media pipeline | 4-5 weeks | 📋 Planned |
| **Phase 8** | Multi-city deployment | 2-3 weeks | 📋 Planned |

**Total estimated**: ~6-7 months for full architecture (Phases 1-8).

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
- `workspace.md` / `agent.md` / `tool.md` / `parent-share.md` / `content.md`: planned —
  not yet authored (frozen by the lead before their phases begin)

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

_Last milestone: PHASE 1 COMPLETE — persistent identity & enrollment (contracts → schema → service → HTTP → join → write-back)_
_Next milestone: Phase 2 — student workspace foundation (works/interactions/memories persist)_
