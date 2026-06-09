# Phase 1 Implementation Brief: Identity & Enrollment

**Phase**: Phase 1
**Duration**: 2-3 weeks
**Status**: Ready for implementation
**Dependencies**: None (builds on MVP baseline)

---

## Objective

Add persistent student identity via parent enrollment before class. Students get permanent IDs that survive across lessons, enabling workspaces, agent memory, and parent co-working in later phases.

---

## Key decisions

1. **Parent enrollment creates student profile before first class** (not retrofit after)
2. **Tenant model from day one** — every entity belongs to a tenant (city/school/org)
3. **Guardian consent required and versioned** — tracks consent policy version
4. **Classroom join uses persistent student ID** — lookup, not create ephemeral
5. **PostgreSQL schema now, even if Redis remains primary for MVP+1** — establishes data model

---

## Non-goals (explicitly deferred)

- ❌ Better Auth / WeChat OAuth (shadow, Phase 3+)
- ❌ Student workspace persistence (Phase 2)
- ❌ Agent service (Phase 4)
- ❌ Parent UI (Phase 3)
- ❌ Multi-region deployment (Phase 8)

---

## Contracts to freeze before implementation

See `docs/contracts/`:

1. **`identity.md`** — Student, Parent, Tenant, GuardianConsent types
2. **`enrollment.md`** — Parent enrollment flow, student creation API

Typed realization: `packages/contracts/src/identity.ts`, `packages/contracts/src/enrollment.ts`

---

## Data model (PostgreSQL schema)

```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('city', 'school', 'partner')),
  region TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  capacity JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE parents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  wechat_open_id TEXT,
  phone_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, wechat_open_id),
  UNIQUE (tenant_id, phone_number)
);

CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  parent_id UUID NOT NULL REFERENCES parents(id),
  display_name TEXT NOT NULL,
  age INTEGER NOT NULL CHECK (age >= 4 AND age <= 10),
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Genius X companion state (from Lesson 1+)
  genius_x_name TEXT,
  genius_x_avatar_url TEXT,
  genius_x_personality_tag TEXT,
  genius_x_background_setting TEXT,
  genius_x_birthday_speech TEXT,
  
  -- Progress tracking
  completed_lesson_ids TEXT[] NOT NULL DEFAULT '{}',
  current_phase INTEGER NOT NULL DEFAULT 1 CHECK (current_phase >= 1 AND current_phase <= 4),
  badges TEXT[] NOT NULL DEFAULT '{}',
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE guardian_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  parent_id UUID NOT NULL REFERENCES parents(id),
  consent_given_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consent_version TEXT NOT NULL,
  data_retention_agreed BOOLEAN NOT NULL DEFAULT true,
  parent_co_work_allowed BOOLEAN NOT NULL DEFAULT false,
  media_usage_allowed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (student_id)
);

CREATE INDEX idx_students_tenant ON students(tenant_id);
CREATE INDEX idx_students_parent ON students(parent_id);
CREATE INDEX idx_parents_tenant ON parents(tenant_id);
```

---

## API endpoints (Identity Service)

Implement in `apps/server/src/identity/` (or `apps/identity-service/` if extracting):

```
POST   /parents                      Create parent account
POST   /students                     Enroll student (parent-initiated)
GET    /students/:id                 Get student profile
PATCH  /students/:id                 Update student profile
PATCH  /students/:id/consent         Update guardian consent
GET    /tenants/:id/students         List students in tenant (admin only)
```

### Example request/response

```typescript
// POST /parents
{
  tenantId: "tenant-uuid",
  wechatOpenId?: "wx123...",  // optional for MVP
  phoneNumber?: "+86..."      // optional for MVP
}
// → { parentId: "parent-uuid", tenantId: "..." }

// POST /students
{
  parentId: "parent-uuid",
  displayName: "小明",
  age: 7,
  consent: {
    consentVersion: "v1.0",
    dataRetentionAgreed: true,
    parentCoWorkAllowed: false,
    mediaUsageAllowed: false
  }
}
// → 201 full Student (key is `id`, NOT `studentId`): EnrollStudentResponse = Student
//    { id: "student-uuid", tenantId: "...", parentId: "...", displayName: "小明", age: 7,
//      enrolledAt: "...", geniusX: {}, progress: { completedLessonIds: [], currentPhase: 1, badges: [] }, ... }
//    (frozen shape — see packages/contracts/src/enrollment.ts; this brief example was pre-freeze)
```

---

## Changes to classroom join

**Current** (`apps/server/src/http.ts`):
```typescript
// Student joins → creates ephemeral studentId
const studentId = role === "student" ? randomUUID() : undefined;
session.students[studentId] = freshStudentState();
```

**Phase 1**:
```typescript
// Student joins → lookup persistent studentId
const { studentId } = req.body; // from client after parent enrollment
if (role === "student") {
  const student = await identityService.getStudent(studentId);
  if (!student) return reply.code(404).send({ error: "STUDENT_NOT_FOUND" });
  if (student.tenantId !== session.tenantId) return reply.code(403).send({ error: "TENANT_MISMATCH" });
  
  // Initialize runtime state if not already in session
  if (!session.students[studentId]) {
    session.students[studentId] = freshStudentState();
    // Pre-fill displayName from persistent profile
    session.students[studentId].displayName = student.displayName;
  }
}
```

---

## Migration path from MVP

1. **Backfill or discard**: Existing ephemeral students from MVP demos have no persistent profiles
   - Option A: Discard (demos only, no production data)
   - Option B: Create synthetic parent+student records for testing continuity

2. **Dual-path compatibility** (not recommended): Support both ephemeral and persistent joins
   - Increases complexity, violates "no hidden fallback" principle
   - Better: complete Phase 1 before next real classroom

3. **Recommended**: Phase 1 is breaking change for student join flow
   - Update client: student selects from enrolled students (or parent enrolls before class)
   - MVP demos can create a "demo tenant" with pre-enrolled test students

---

## Tests to add

### Unit tests

`apps/server/src/identity/identity.test.ts`:
- Parent creation
- Student enrollment with consent
- Student lookup by ID
- Tenant isolation (student from tenant A cannot access tenant B data)
- Age validation (4-10 only)
- Consent version tracking

### Integration tests

`apps/server/src/identity/identity.e2e.test.ts`:
- Full enrollment flow: create parent → enroll student → join classroom
- Guardian consent update
- Student profile update (displayName, genius_x fields)

### Classroom join tests

Update `apps/server/src/http.test.ts`:
- Join with valid persistent studentId
- Join with invalid studentId returns 404
- Join with studentId from different tenant returns 403
- Student displayName pre-filled from profile

---

## Rollout plan

1. **Freeze contracts** — create `identity.md`, `enrollment.md`, update `contracts/README.md`
2. **PostgreSQL schema** — apply migration, seed demo tenant + students
3. **Identity Service** — implement endpoints, tests green
4. **Update classroom join** — use persistent studentId, tests green
5. **Update client** — student selection UI (or admin tool for MVP+1)
6. **Validate end-to-end** — parent enrolls → student joins → class runs → profile updated

---

## Open questions

1. **Tenant seeding**: Manual SQL insert or admin API?
   - Recommendation: SQL for first tenant, admin API for Phase 8

2. **Parent authentication**: Skip for Phase 1, or add lightweight phone OTP?
   - Recommendation: Skip; Better Auth in Phase 3

3. **Student selection UI**: Full parent app or simple admin tool?
   - Recommendation: Admin tool for Phase 1; parent app in Phase 3

4. **Backfill strategy**: Synthetic records or clean slate?
   - Recommendation: Clean slate; MVP demos are ephemeral

---

## Definition of Done

- [ ] Contracts `identity.md` and `enrollment.md` frozen
- [ ] PostgreSQL schema applied
- [ ] Identity Service API implemented and tested
- [ ] Classroom join updated to use persistent studentId
- [ ] All tests green (unit + integration + classroom join)
- [ ] End-to-end validated: enroll → join → class → profile updated
- [ ] Documentation updated: PROGRESS.md, DEFERRED.md, contracts/README.md
- [ ] Demo tenant + test students seeded

---

_Phase 1 · Identity & Enrollment_
_Ready for implementation: 2026-06-08_
