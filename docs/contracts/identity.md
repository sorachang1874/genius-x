# Identity Contract (Phase 1)

**Status**: Frozen v1
**Owner**: Identity Service (Agent G)
**Phase**: Phase 1 — Persistent identity & enrollment
**Typed realization**: `packages/contracts/src/identity.ts`
**Companion contract**: [`enrollment.md`](enrollment.md) (API surface, error codes)
**Last updated**: 2026-06-09

---

## Purpose

Define persistent student and parent identity model, enrollment flow, tenant isolation, and guardian consent semantics. Enables student workspaces, AI agent memory, and parent co-working in later phases.

---

## Scope

This contract covers:
- Student, Parent, Tenant data models
- Guardian consent semantics
- Tenant isolation boundaries
- Identity lifecycle (create, read, update, no delete for MVP)

Out of scope (deferred):
- Authentication/authorization (Better Auth, Phase 3+)
- WeChat OAuth (Phase 6)
- Parent UI (Phase 3)
- Student workspace (Phase 2)
- Cross-tenant queries (Phase 8)

---

## Public interface

> **Typed naming & relationships** (see `packages/contracts/src/identity.ts`):
> - `Student` is the **persistent** identity record (PostgreSQL). It is distinct from
>   `StudentRuntimeState` (per-class Redis runtime, keyed by `Student.id` after Phase 1) and
>   from the legacy `StudentProfile`, now **`@deprecated`** in favor of `Student` + the Phase 2
>   workspace.
> - The nested companion/progress objects are typed as `GeniusXProfile` and `StudentProgress`
>   to avoid colliding with the runtime `GeniusX`/`Progress`. Unlike runtime `GeniusX`,
>   `GeniusXProfile` carries **no** `memories` array — persistent memories are Phase 2.
> - Identity-API error codes are typed as `IdentityErrorCode` (in `enrollment.ts`), separate
>   from the child-never-sees `ErrorCode` registry in `errors.ts`.
> - `PREMIUM_CLASSROOM` (exported constant) is the single source of truth for the corrected
>   capacity model: 20–30 students, 4–6 assistants, 1 assistant per 5 students.

### Student

Persistent child profile, created via parent enrollment before first class.

```typescript
interface Student {
  id: string;                    // UUID, permanent across all lessons
  tenantId: string;              // city/school/org
  parentId: string;              // references Parent
  displayName: string;           // child's name for UI/certificate
  age: number;                   // 4-10 per product rules
  enrolledAt: string;            // ISO timestamp
  
  // Genius X companion state (populated during/after Lesson 1)
  geniusX: {
    name?: string;               // confirmed in Lesson 2
    avatarUrl?: string;          // from Lesson 1 Shape
    personalityTag?: string;     // extracted during interactions
    backgroundSetting?: string;  // from Lesson 1 Shape
    birthdaySpeech?: string;     // from Lesson 1 Birth
  };
  
  // Progress tracking
  progress: {
    completedLessonIds: string[];
    currentPhase: number;        // 1-4 per Manifesto growth arc
    badges: string[];
  };
  
  createdAt: string;
  updatedAt: string;
}
```

### Parent

Guardian account linked to one or more students.

```typescript
interface Parent {
  id: string;                    // UUID
  tenantId: string;
  wechatOpenId?: string;         // for WeChat miniapp (Phase 6+)
  phoneNumber?: string;          // for SMS notifications (optional)
  createdAt: string;
}
```

### Tenant

Organizational unit (city, school, partner org) for multi-city isolation.

```typescript
interface Tenant {
  id: string;
  name: string;                  // "Beijing Haidian Campus"
  type: "city" | "school" | "partner";
  region: string;                // "cn-north", "cn-east", "cn-south"
  
  config: {
    databaseUrl?: string;        // tenant-specific DB (Phase 8)
    objectStorageBucket?: string;// tenant-isolated bucket (Phase 2)
    aiProviderConfig?: string;   // tenant-specific routing (Phase 8)
  };
  
  capacity: {
    maxStudents: number;
    maxConcurrentSessions: number;
  };
  
  status: "active" | "suspended" | "archived";
  createdAt: string;
  updatedAt: string;
}
```

### GuardianConsent

Versioned consent record per student.

```typescript
interface GuardianConsent {
  studentId: string;
  parentId: string;
  consentGivenAt: string;
  consentVersion: string;        // tracks consent policy version
  dataRetentionAgreed: boolean;
  parentCoWorkAllowed: boolean;  // can parent initiate interactions? (Phase 6)
  mediaUsageAllowed: boolean;    // can works be used for showcase/promotion?
}
```

---

## Owner matrix

All fields below are **new in Phase 1** (Migration column = "new v1" unless noted).

| Field | Owner | Source of truth | Allowed values | Derivation | Consumers | Fallback | Deletion condition | Migration | Preflight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Student.id` | Identity Service | `students` table (PostgreSQL) | UUID | generated on enrollment | Classroom, Workspace, Agent | none | never hard-deleted (soft delete = Phase 8) | new v1 | query by id returns record |
| `Student.displayName` | Parent (at enrollment) | `students.display_name` | non-empty string | parent input | Classroom UI, Certificate, Workspace | none | editable by parent | new v1 | length > 0 |
| `Student.age` | Parent (at enrollment) | `students.age` | 4-10 | parent input | Classroom (phase gating), Agent | none | updated annually or on parent request | new v1 | 4 ≤ age ≤ 10 |
| `Student.tenantId` | Identity Service | `students.tenant_id` | valid tenant UUID | assigned at enrollment | All services (isolation) | none | immutable | new v1 | foreign key enforced |
| `Parent.id` | Identity Service | `parents` table | UUID | generated on creation | Student enrollment, consent | none | never hard-deleted (soft delete = Phase 8) | new v1 | query by id returns record |
| `Parent.wechatOpenId` / `phoneNumber` | Parent | `parents.wechat_open_id` / `phone_number` | optional string | parent input | `POST /parents` idempotency / 409 dedup | none | editable | new v1 | `UNIQUE(tenant_id, wechat_open_id)` + `UNIQUE(tenant_id, phone_number)` |
| `Tenant.id` | Identity Service | `tenants` table | UUID | generated on creation | All services | none | archived, not deleted | new v1 | query by id returns record |
| `GuardianConsent.consentVersion` | Identity Service (policy version) | `guardian_consents.consent_version` | semantic version | request body (agreed version echoed back) | Parent co-work gate (Phase 6) | none | overwritten when policy changes | new v1 | version format valid |
| `GuardianConsent.parentCoWorkAllowed` | Parent | `guardian_consents.parent_co_work_allowed` | boolean (default false) | parent input | Parent co-work gate (Phase 6) | default false | overwritten on consent update | new v1 | parent-initiated interaction requires `true` |
| `GuardianConsent.mediaUsageAllowed` | Parent | `guardian_consents.media_usage_allowed` | boolean (default false) | parent input | Showcase/promotion (Content, Phase 7) | default false | overwritten on consent update | new v1 | a work shown in showcase ⇒ its student has `mediaUsageAllowed = true` |
| `ClassSession.tenantId` | Classroom Service | `ClassSession` (Redis) | valid tenant id | set at session creation (immutable) | Classroom join (isolation check) | none | with session | new v1 | every live session has a tenantId; join asserts `student.tenantId === session.tenantId` |
| `PREMIUM_CLASSROOM` | Classroom model | `packages/contracts/src/identity.ts` (constant) | 20-30 students, 4-6 assistants, 1:5 | frozen constant | Seeds, capacity planning, Classroom (Phase 5+) | none | n/a | new v1 | Phase-1 seeds + capacity docs use 20-30 (the superseded "60" model is gone); per-class counts within range |

---

## Consumers

- **Classroom Service**: Looks up student by ID on join, pre-fills `displayName`
- **Workspace Service** (Phase 2): Writes works/interactions tagged with `studentId`, enforces tenant isolation
- **Agent Service** (Phase 4): Builds context from student's persistent memories
- **Parent Service** (Phase 3): Generates parent share artifact for student
- **Content Service** (Phase 7): Stores media in tenant-isolated bucket

---

## Tenant isolation

**Rule**: A student from tenant A can never access data from tenant B.

**Enforcement**:
- All queries filter by `tenantId` (WHERE clause or row-level security)
- Classroom join validates `student.tenantId === session.tenantId` (the session carries
  `ClassSession.tenantId`; mismatch ⇒ `403 TENANT_MISMATCH`)
- Object storage buckets are tenant-isolated (Phase 2/7)
- Cross-tenant queries require admin role (Phase 8+)

**Preflight (Phase 1)**: The join-time isolation check lives in the **application** (sessions
are in Redis, not a `class_sessions` table), so it is verified by a unit test asserting a
cross-tenant join returns `403 TENANT_MISMATCH`, plus these executable data-integrity queries:
```sql
-- No student references a tenant that does not exist (FK already enforces this)
SELECT COUNT(*) FROM students WHERE tenant_id NOT IN (SELECT id FROM tenants);  -- 0
-- No student/parent tenant mismatch (a student's tenant must match its parent's)
SELECT COUNT(*) FROM students s JOIN parents p ON s.parent_id = p.id
WHERE s.tenant_id != p.tenant_id;  -- 0
```
> The session↔student cross-tenant query over an archived `class_sessions` table is a **later
> phase** preflight (session archival does not exist in Phase 1). Phase 1's guarantee is the
> app-level join assertion above.

---

## Lifecycle

### Student creation
1. Parent account created (or exists)
2. Parent enrolls student with `displayName`, `age`, `consent`
3. Identity Service validates age 4-10, creates student record
4. Guardian consent record created
5. Student ID returned to parent

### Student join classroom
1. Client sends `studentId` in join request
2. Identity Service validates student exists and belongs to session's tenant
3. Classroom creates runtime state, pre-fills `displayName` from profile
4. Student participates in lesson

### Student progress update
1. After lesson completion, Classroom Service updates `Student.progress.completedLessonIds`
2. After stage completion, Classroom Service updates `Student.geniusX` fields (avatar, speech, etc.)

### Parent update student
1. Parent can update `displayName` via Identity Service API
2. Age updated annually or on request
3. Consent can be updated (new version recorded)

### Soft delete (Phase 8+ — deferred)
- Student/parent accounts are never hard-deleted.
- The soft-delete mechanism (a `status` column on `students`/`parents`, mirroring
  `Tenant.status`) is **not in the Phase 1 schema or types** — it ships in Phase 8 together
  with the deletion flow. Until then the owner-matrix "never hard-deleted" condition is an
  invariant with no inactivation field yet. Only `Tenant` has a `status` in Phase 1.
- Data retained per retention policy (see `data-and-privacy.md`).

---

## Divergence from architecture v2 §2.2

The frozen Phase 1 types intentionally omit three fields the v2 design sketch (§2.2) shows on
`Student`/`Parent`. These are correct deferrals, not oversights:

- **`Student.agentId`** — deferred to **Phase 4** (Agent Service). No agent exists in Phase 1.
- **embedded `Student.guardianConsent`** — consent is a **separate `GuardianConsent` record**
  (its own table, `UNIQUE(student_id)`), not embedded on the student.
- **`Parent.studentIds[]`** — normalized away: a parent's children are derived via
  `students.parent_id`. There is no `studentIds` column and no read-children endpoint in
  Phase 1 (a parent-scoped list arrives with the Parent UI, Phase 3).

---

## Failure modes

| Scenario | Behavior | Recovery |
| --- | --- | --- |
| Student ID not found on join | 404 STUDENT_NOT_FOUND | Parent re-enrolls or corrects ID |
| Student from wrong tenant | 403 TENANT_MISMATCH | Classroom rejects join |
| Age out of range (not 4-10) | 400 INVALID_AGE | Parent corrects age |
| Duplicate parent (same phone/WeChat) | **200** — `POST /parents` is idempotent: returns the existing `parentId` | Reuse the returned id to enroll the next child |
| Conflicting parent identifiers (phone↔parent A, wechat↔parent B) | 409 PARENT_ALREADY_EXISTS | Operator resolves the duplicate out-of-band |
| Missing guardian consent | 400 CONSENT_REQUIRED | Parent provides consent (`dataRetentionAgreed: true`) |
| Consent version mismatch | Parent shown updated consent, must re-agree | The single consent row is overwritten to the new version (one row per student; prior version not retained — history is a future audit-log extension) |

---

## Migration from MVP

**Current MVP**: Students are ephemeral, created on classroom join with `randomUUID()`.

**Phase 1 breaking change**: Classroom join requires persistent `studentId` from enrollment.

**Migration strategy**:
1. **Discard ephemeral students** — MVP demos have no production data to preserve
2. **Seed demo tenant** — create test tenant + parent + students for development
3. **Update client** — show enrolled students list or admin enrollment tool
4. **No dual-path** — do not support both ephemeral and persistent (violates "no hidden fallback")

---

## Validation

### Schema validation
- `Student.age`: 4 ≤ age ≤ 10
- `Student.displayName`: non-empty string
- `Student.tenantId`: must reference existing tenant
- `Parent.tenantId`: must reference existing tenant
- `GuardianConsent.consentVersion`: semantic version format

### Business rules
- One guardian consent per student (unique constraint)
- Parent can enroll multiple students
- Student belongs to exactly one parent (for MVP; multi-parent deferred)
- Tenant isolation enforced in all queries

### Preflight
```bash
# All students belong to valid tenants
psql -c "SELECT COUNT(*) FROM students WHERE tenant_id NOT IN (SELECT id FROM tenants);"
# Expected: 0

# All students have exactly one consent
psql -c "SELECT COUNT(*) FROM students s WHERE NOT EXISTS (SELECT 1 FROM guardian_consents gc WHERE gc.student_id = s.id);"
# Expected: 0

# A student's tenant matches its parent's tenant (no cross-tenant enrollment)
psql -c "SELECT COUNT(*) FROM students s JOIN parents p ON s.parent_id = p.id WHERE s.tenant_id != p.tenant_id;"
# Expected: 0
```
> The cross-tenant **join** guarantee (`student.tenantId === session.tenantId`) is an
> application-level check (sessions live in Redis), verified by a unit test — see
> **Tenant isolation → Preflight** above, not a SQL query in Phase 1.

---

## Security and privacy

- **No raw PII in logs**: Student names, phone numbers redacted in traces
- **Consent version tracking**: Auditable consent changes
- **Tenant isolation**: Enforced at data layer, not just application
- **Parent authentication** (Phase 3+): WeChat OAuth or phone OTP
- **GDPR/China compliance**: Data retention policy, parent data export (Phase 8)

---

## Performance

- **Student lookup**: Indexed by `id`, `tenant_id`, `parent_id`
- **Parent lookup**: Indexed by `tenant_id`, `wechat_open_id`, `phone_number`
- **Tenant lookup**: Indexed by `id`
- **Expected latency**: < 10ms for student/parent lookup
- **Expected scale**: 10,000 students per tenant, 100 tenants

---

## Dependencies

- PostgreSQL 14+ (JSONB, UUID, timestamptz)
- No Redis dependency for identity (stateless reads)
- No authentication dependency (Phase 1 trusts client `studentId`)

---

## Future extensions

- **Multi-parent per student** (guardians, grandparents)
- **Student transfer** (change parent or tenant)
- **Consent audit log** (track all consent changes)
- **Parent authentication** (WeChat OAuth, phone OTP)
- **Cross-tenant analytics** (admin queries)

---

_Identity Contract · Phase 1 · Frozen v1 · 2026-06-09_
