# Phase 1 Implementation Handbook

**Date**: 2026-06-08
**Target**: Phase 1 — Identity & Enrollment (2-3 weeks)
**Prerequisites**: Read this handbook before starting implementation

---

## Critical context corrections

### ⚠️ Classroom capacity model (premium service)

**CORRECTED CAPACITY**:
- **20-30 students per classroom** (not 60)
- **4-6 assistants** (1 assistant per 5 students for personalized guidance)
- Premium service model: high-touch, individualized attention

**Infrastructure needs**:
- Redis: 1-1.5MB per session (trivial)
- PostgreSQL: 2-3MB archived per class
- Object Storage: 200-300MB per class
- Compute: 2-4 CPU cores, 4-8GB RAM per classroom service

**Why premium model**:
- Personalized attention for each child
- Real-time intervention when child is stuck
- Richer observation for agent learning (assistant notes can inform agent)
- Higher quality interaction data
- Better parent reports with specific observations from assistants

**Scale-out**: 20+ concurrent classrooms → add horizontal replicas

---

## Architecture overview

### What we're building (8-phase roadmap)

**Current state**: MVP classroom-centric, ephemeral students
**Target state**: Student-centric platform with persistent workspaces and AI agents

**Phase 1 (YOU ARE HERE)**: Add persistent identity
- Parent enrolls student before class
- Student gets permanent UUID that survives across lessons
- Classroom join uses persistent studentId (not ephemeral)

**Future phases** (after Phase 1):
- Phase 2: Student workspace (works, interactions, memories persist)
- Phase 3: Parent read-only artifact (H5, WeChat notification)
- Phase 4: AI agent with long-term memory
- Phase 5: Tool-calling framework
- Phase 6: Parent co-working
- Phase 7: Rich media (video, 3D)
- Phase 8: Multi-city deployment

---

## Key documents to read FIRST

**Before writing any code**, read these in order:

1. **This handbook** (`docs/agents/briefs/PHASE1_HANDBOOK.md`) — you're reading it
2. **`docs/contracts/identity.md`** — Identity contract (Student, Parent, Tenant, GuardianConsent)
3. **`docs/agents/briefs/Phase1-identity-enrollment.md`** — Implementation brief with PostgreSQL schema
4. **`docs/architecture/scalable-architecture-v2.md` §2.2** — Core data models in detail
5. **`AGENTS.md`** — Agent ownership map and hard rules

Optional deep-dive:
- `docs/architecture/scalable-architecture-v2.md` (full 1,344-line design)
- `docs/NEXT_SESSION.md` (architecture summary)

---

## What Phase 1 delivers

### User-facing changes

**Before Phase 1**:
- Student joins classroom with room code
- Server creates ephemeral `studentId = randomUUID()`
- After class ends, student data is lost

**After Phase 1**:
- Parent enrolls student before class (admin tool or API)
- Student has permanent `studentId` stored in PostgreSQL
- Student joins classroom using their persistent `studentId`
- After class ends, student profile persists with updated progress

### Technical changes

**New PostgreSQL tables**:
- `tenants` — cities, schools, orgs
- `parents` — guardian accounts
- `students` — permanent student profiles
- `guardian_consents` — versioned consent records

**New Identity Service** (`apps/server/src/identity/`):
- `POST /parents` — create parent account
- `POST /students` — enroll student
- `GET /students/:id` — get student profile
- `PATCH /students/:id` — update profile
- `PATCH /students/:id/consent` — update consent

**Updated classroom join** (`apps/server/src/http.ts`):
- Lookup persistent `studentId` instead of creating ephemeral
- Pre-fill `displayName` from student profile
- Validate tenant isolation

---

## Implementation sequence (contract-first)

### Step 1: Freeze contracts (Day 1)

**What**: Define and freeze Phase 1 contracts before writing code

**Tasks**:
1. Review `docs/contracts/identity.md` (already drafted)
2. Create `docs/contracts/enrollment.md` (enrollment flow contract)
3. Create typed contracts in `packages/contracts/src/`:
   - `identity.ts` — Student, Parent, Tenant, GuardianConsent types
   - `enrollment.ts` — Enrollment API request/response types
4. Export from `packages/contracts/src/index.ts`
5. Update `docs/contracts/README.md` to mark contracts as "frozen"

**Definition of done**:
- [ ] `identity.md` and `enrollment.md` reviewed and frozen
- [ ] Typed contracts in `packages/contracts/src/` match prose contracts
- [ ] `pnpm --filter @genius-x/contracts typecheck` passes
- [ ] Contracts README updated

### Step 2: PostgreSQL schema (Day 1-2)

**What**: Apply database schema, seed demo tenant

**Tasks**:
1. Create migration file: `apps/server/migrations/001_phase1_identity.sql`
2. Apply schema (students, parents, tenants, guardian_consents tables)
3. Add indexes per identity contract
4. Seed demo tenant + test parent + 3-5 test students
5. Document connection setup in README

**Definition of done**:
- [ ] Migration file created and applied
- [ ] All tables and indexes created
- [ ] Demo tenant seeded with test data
- [ ] Connection pooling configured
- [ ] `psql -c "SELECT COUNT(*) FROM students;"` returns test students

### Step 3: Identity Service implementation (Day 3-7)

**What**: Implement Identity Service API + unit tests

**Tasks**:
1. Create `apps/server/src/identity/` directory
2. Implement `IdentityService` class with methods:
   - `createParent(tenantId, wechatOpenId?, phoneNumber?)`
   - `enrollStudent(parentId, displayName, age, consent)`
   - `getStudent(studentId)`
   - `updateStudent(studentId, updates)`
   - `updateConsent(studentId, consent)`
   - `listTenantStudents(tenantId)` (admin only)
3. Add PostgreSQL client (pg/Prisma/TypeORM)
4. Add tenant isolation to all queries
5. Write unit tests: `identity.test.ts`
6. Write integration tests: `identity.e2e.test.ts`

**Definition of done**:
- [ ] Identity Service implemented
- [ ] All unit tests green (cover: create, read, update, tenant isolation, age validation)
- [ ] All integration tests green (cover: full enrollment flow, consent updates)
- [ ] `pnpm --filter @genius-x/server test` passes

### Step 4: HTTP API endpoints (Day 8-10)

**What**: Expose Identity Service via HTTP

**Tasks**:
1. Add routes to `apps/server/src/http.ts` (or new `identity/routes.ts`)
2. Wire Identity Service into server factory
3. Add request validation (Zod schemas)
4. Add error handling (404, 403, 400, 409)
5. Update HTTP tests

**Endpoints**:
```typescript
POST   /parents                      // Create parent
POST   /students                     // Enroll student  
GET    /students/:id                 // Get profile
PATCH  /students/:id                 // Update profile
PATCH  /students/:id/consent         // Update consent
GET    /tenants/:id/students         // List (admin)
```

**Definition of done**:
- [ ] All endpoints implemented and tested
- [ ] Request validation works (400 on invalid input)
- [ ] Tenant isolation enforced (403 on cross-tenant access)
- [ ] `apps/server/src/http.test.ts` updated and passing

### Step 5: Update classroom join (Day 11-12)

**What**: Classroom join uses persistent studentId

**Tasks**:
1. Update `POST /session/join` in `apps/server/src/http.ts`
2. Add studentId lookup via Identity Service
3. Validate student exists and belongs to session's tenant
4. Pre-fill `displayName` from student profile
5. Update join tests
6. **Tenant fail-closed in live/production** (carried from Step-2 review): in `live`/
   `production` mode the session tenant must be explicitly configured — `DEFAULT_DEMO_TENANT_ID`
   stays a dev/demo-only default, never a silent production fallback.

**Current code**:
```typescript
const studentId = role === "student" ? randomUUID() : undefined;
session.students[studentId] = freshStudentState();
```

**New code**:
```typescript
if (role === "student") {
  const { studentId } = req.body;
  const student = await identityService.getStudent(studentId);
  if (!student) return reply.code(404).send({ error: "STUDENT_NOT_FOUND" });
  if (student.tenantId !== session.tenantId) return reply.code(403).send({ error: "TENANT_MISMATCH" });
  
  if (!session.students[studentId]) {
    session.students[studentId] = freshStudentState();
    session.students[studentId].displayName = student.displayName;
  }
}
```

**Definition of done**:
- [ ] Classroom join updated
- [ ] Tests cover: valid studentId, invalid studentId (404), wrong tenant (403)
- [ ] displayName pre-filled from profile
- [ ] `apps/server/src/http.test.ts` passing

### Step 6: End-to-end validation (Day 13-14)

**What**: Validate full enrollment → classroom flow

**Tasks**:
1. Create or update e2e test: `identity-classroom.e2e.test.ts`
2. Test flow: create parent → enroll student → join classroom → interact → check profile updated
3. Manual smoke test with demo-start.sh
4. Update web client to send persistent studentId (or use admin tool for MVP)

**Test scenario**:
```typescript
// 1. Enroll
const parent = await createParent({ tenantId: "demo-tenant" });
const student = await enrollStudent({
  parentId: parent.id,
  displayName: "测试学生",
  age: 7,
  consent: { consentVersion: "v1.0", dataRetentionAgreed: true }
});

// 2. Join classroom
const joinRes = await joinSession({
  roomCode: "test-room",
  studentId: student.id  // persistent, not ephemeral
});

// 3. Interact
await sendInteraction(student.id, { type: "voice", text: "你好" });

// 4. Verify profile updated
const updatedStudent = await getStudent(student.id);
expect(updatedStudent.progress.completedLessonIds).toContain("lesson-001");
```

**Definition of done**:
- [ ] E2e test green
- [ ] Manual smoke test successful
- [ ] Client updated (or admin tool created for MVP)
- [ ] Full flow validated: enroll → join → class → profile persists

### Step 7: Documentation and cleanup (Day 15)

**What**: Update docs, clean up, prepare handoff

**Tasks**:
1. Update `PROGRESS.md` — mark Phase 1 complete
2. Update `docs/DEFERRED.md` — mark DF-v2-1 resolved
3. Update `docs/contracts/README.md` — mark identity/enrollment as "frozen v1"
4. Add migration guide: `docs/migration/mvp-to-phase1.md`
5. Clean up debug logs
6. Run full test suite

**Definition of done**:
- [ ] All docs updated
- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] No debug console.logs in production code
- [ ] Migration guide written

---

## Hard rules (from AGENTS.md)

**Product rules that bind technical work**:
- ❌ No quiz/test logic
- ❌ No child-facing "Prompt/LLM/token/AI/model" wording
- ❌ No visible child failure state — every input gets positive output
- ✅ Latency dressed as "thinking"
- ✅ User-invisible fallback must stay operator-visible
- ✅ Model output is a contract (prompt versioning, schema validation)

**Technical rules**:
- ✅ Contract-first development (freeze before implement)
- ✅ No hidden fallback paths
- ✅ Shadow systems remain pluggable (auth, CMS deferred)
- ✅ Tenant isolation enforced at data layer
- ✅ Tests before signoff

---

## Open decisions documented

See `docs/architecture/scalable-architecture-v2.md` §14 for full list.

**Decisions needed for Phase 1**:
1. **Tenant seeding**: Manual SQL or admin API?
   - Recommendation: SQL for first tenant, admin API later
2. **Parent auth**: Skip for Phase 1 or add phone OTP?
   - Recommendation: Skip; Better Auth in Phase 3
3. **Student selection UI**: Parent app or admin tool?
   - Recommendation: Admin tool for Phase 1
4. **Backfill strategy**: Synthetic records or clean slate?
   - Recommendation: Clean slate; MVP demos are ephemeral

---

## Definition of Done (Phase 1 checklist)

- [ ] Contracts frozen (`identity.md`, `enrollment.md`, typed contracts)
- [ ] PostgreSQL schema applied, demo tenant seeded
- [ ] Identity Service implemented and tested (unit + integration)
- [ ] HTTP API endpoints implemented and tested
- [ ] Classroom join updated to persistent studentId
- [ ] All tests green (`pnpm typecheck`, `pnpm test`, e2e)
- [ ] End-to-end validated (enroll → join → class → profile persists)
- [ ] Docs updated (PROGRESS.md, DEFERRED.md, contracts/README.md)
- [ ] Migration guide written
- [ ] No debug console.logs in production code

---

## Troubleshooting

### PostgreSQL connection issues
```bash
# Check connection
psql -h localhost -U postgres -d genius_x -c "SELECT 1;"

# Check tables created
psql -d genius_x -c "\dt"
```

### Tenant isolation not working
```sql
-- Preflight: no cross-tenant pollution
SELECT COUNT(*) FROM students s
WHERE s.tenant_id NOT IN (SELECT id FROM tenants);
-- Expected: 0
```

### Tests failing after migration
```bash
# Clear test DB
dropdb genius_x_test && createdb genius_x_test
# Re-run migrations
psql -d genius_x_test -f apps/server/migrations/001_phase1_identity.sql
# Re-seed test data
psql -d genius_x_test -f apps/server/migrations/001_phase1_identity_seed.sql
```

---

## Next session after Phase 1

After Phase 1 is complete and merged:
- **Phase 2**: Student workspace (works, interactions, memories persist)
- **Phase 3**: Parent read-only artifact (H5, WeChat notification)

Read `docs/agents/briefs/Phase2-workspace.md` (to be created after Phase 1 complete).

---

_Phase 1 Implementation Handbook_
_Last updated: 2026-06-08_
_Ready for implementation start_
