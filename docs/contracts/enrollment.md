# Enrollment Contract (Phase 1)

**Status**: Frozen v1.1 (v1 + the sanitized-500 rule — see Changelog)
**Owner**: Identity Service (Agent G)
**Phase**: Phase 1 — Persistent identity & enrollment
**Typed realization**: `packages/contracts/src/enrollment.ts`
**Companion contract**: [`identity.md`](identity.md) (data model)
**Last updated**: 2026-06-09

---

## Purpose

Define the HTTP surface by which a parent enrolls a student before class, reads/updates that
student, and updates guardian consent — plus the API error registry and its HTTP status
mapping. The data model itself lives in [`identity.md`](identity.md); this contract owns the
**request/response shapes**, **error semantics**, and the **classroom-join migration**.

This is a **boundary contract**: typed IO, consumes/produces, failure mode. Internal module
design (PostgreSQL client, service wiring) is produced per-task as a design note and
lead-reviewed before coding — not frozen here.

---

## Scope

In scope:
- Parent creation, student enrollment, student read/update, consent update, tenant listing.
- API error codes and HTTP status mapping.
- The breaking change to classroom join (`SessionJoinRequest.studentId`).

Out of scope (deferred):
- Parent authentication (Better Auth / WeChat OAuth — Phase 3/6). Phase 1 **trusts** the
  client-supplied `studentId`/`parentId`; admin endpoints are operator-only by convention.
- Student workspace writes (works/interactions/memories — Phase 2).
- Parent UI (Phase 3); enrollment is driven by an admin tool / API for Phase 1.

---

## Public interface

All bodies are JSON. Types are in `@genius-x/contracts` (`enrollment.ts`). Field-level
validation (age bounds, non-empty name, semantic-version format) is enforced with zod at the
service boundary; the typed contracts are pure TS.

| Method & path | Request | Success | Notes |
| --- | --- | --- | --- |
| `POST /parents` | `CreateParentRequest` | `201` (created) / `200` (existing) `CreateParentResponse` | `tenantId` must exist. **Idempotent**: a plain duplicate phone/wechat returns the existing `parentId` (`200`); only an ambiguous conflict ⇒ `409`. |
| `POST /students` | `EnrollStudentRequest` | `201` `EnrollStudentResponse` (full `Student`) | `tenantId` derived from the parent; creates the `GuardianConsent` record atomically. |
| `GET /students/:id` | — | `200` `GetStudentResponse` (`Student`) | `404` if absent. |
| `PATCH /students/:id` | `UpdateStudentRequest` | `200` `UpdateStudentResponse` (`Student`) | Parent-facing: **only** `displayName`, `age`. |
| `PATCH /students/:id/consent` | `UpdateConsentRequest` (`ConsentInput`) | `200` `UpdateConsentResponse` (`GuardianConsent`) | Overwrites the single consent row to the new version (prior not retained). |
| `GET /tenants/:id/students` | `ListTenantStudentsQuery` (`?limit&cursor`) | `200` `ListTenantStudentsResponse` (+ `nextCursor?`) | Admin-only (operator convention in Phase 1); cursor-paginated. |

### Server-owned mutation (not an HTTP endpoint)

`StudentProgressUpdate` (`{ geniusX?, progress? }`) is applied by the **Classroom Service**
after a stage/lesson (avatar minted, lesson completed). It is contract-defined so the shape is
not redefined locally, but it is **not reachable through the parent API** — the parent `PATCH`
deliberately cannot write companion state or progress. This is the privilege boundary.

### Example

```jsonc
// POST /parents  (idempotent: 201 if new, 200 returning the existing parent on duplicate)
{ "tenantId": "<tenant-uuid>", "phoneNumber": "+8613800000000" }
// → 201|200 { "parentId": "<parent-uuid>", "tenantId": "<tenant-uuid>" }

// POST /students
{
  "parentId": "<parent-uuid>",
  "displayName": "小明",
  "age": 7,
  "consent": { "consentVersion": "v1.0", "dataRetentionAgreed": true }
}
// → 201 full Student { id, tenantId, parentId, displayName, age, enrolledAt,
//                      geniusX: {}, progress: { completedLessonIds: [], currentPhase: 1, badges: [] }, ... }
```

---

## Error codes & HTTP status mapping

Typed as `IdentityErrorCode`; body is `IdentityErrorResponse` (`{ error, detail? }`). These
are **operator/parent-facing** and are explicitly distinct from the child-never-sees
`ErrorCode` registry in `errors.ts` (those map to a positive child fallback; these are API
errors with status codes).

| Code | HTTP | When |
| --- | --- | --- |
| `STUDENT_NOT_FOUND` | 404 | `GET/PATCH /students/:id` or join with unknown `studentId`. |
| `PARENT_NOT_FOUND` | 404 | Enroll under a non-existent `parentId`. |
| `TENANT_NOT_FOUND` | 404 | Create parent under a non-existent `tenantId`. |
| `TENANT_MISMATCH` | 403 | Cross-tenant access (e.g. student vs session tenant on join). |
| `INVALID_AGE` | 400 | `age` outside 4–10. |
| `INVALID_INPUT` | 400 | Schema / validation failure (missing `studentId` on student join, bad version, empty name). |
| `CONSENT_REQUIRED` | 400 | Consent missing or `dataRetentionAgreed !== true`. |
| `PARENT_ALREADY_EXISTS` | 409 | **Ambiguous conflict only**: supplied identifiers match two different parents. A plain duplicate is NOT an error — `POST /parents` returns the existing parent (`200`). |

`detail` carries operator/debug context only and is **never rendered to a child**. No raw PII
(names, phone numbers) in `detail` or logs (see identity.md → Security and privacy).

**Undefined failures (500)**: an unexpected server error outside the failure modes above
returns `500 { "error": "INTERNAL" }` — deliberately **off** this registry: mapping an
undefined failure to a contract code would misreport it. Clients must treat any error value
outside `IdentityErrorCode` as a retryable internal failure. Wire-level parse failures
(malformed/empty JSON, wrong content-type) map to `400 INVALID_INPUT` with the parser code in
`detail`. _(Added v1.0→v1.1 by lead serialization, Step-4 review.)_

---

## Owner matrix

| Field / behavior | Owner | Source of truth | Allowed values | Consumers | Fallback | Deletion condition | Preflight |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `EnrollStudentRequest.age` | Parent | request body | integer 4–10 | Identity Service | none (reject `INVALID_AGE`) | n/a | zod `int().min(4).max(10)` |
| `ConsentInput.dataRetentionAgreed` | Parent | request body | `true` to enroll | Identity Service | none (reject `CONSENT_REQUIRED`) | n/a | must be `true` |
| `ConsentInput.consentVersion` | Identity Service (policy version) | request body (agreed version echoed back) | semantic version | Consent record, Phase 6 co-work gate | none | overwritten on update | version format valid |
| `UpdateStudentRequest` | Parent | request body | `{ displayName?, age? }` only | Identity Service | none | n/a | rejects keys outside the allowlist |
| `StudentProgressUpdate` | Classroom Service | server-internal | `{ geniusX?, progress? }` | Student record | none | n/a | not exposed over HTTP |
| `IdentityErrorResponse.error` | Identity Service | this contract | `IdentityErrorCode` | Admin tool, client | none | n/a | every error path returns one |
| `SessionJoinRequest.studentId` | Client | request body | UUID (student role) | Classroom join | none — reject, no ephemeral fallback | n/a | present + resolvable for student role |

_All rows: **Derivation** = from the request body unless marked server-internal; **Migration**
= new in v1 (no prior shape to migrate)._

---

## Consumers

- **Admin tool** (Phase 1): drives `POST /parents`, `POST /students`, `GET /tenants/:id/students`.
- **Classroom Service**: consumes `GET /students/:id` semantics on join; applies
  `StudentProgressUpdate` after stages/lessons.
- **Parent UI** (Phase 3): will consume `GET/PATCH /students/:id`, `PATCH .../consent`.

---

## Classroom-join migration (breaking change)

**Current MVP** (`apps/server/src/http.ts`): a student join mints an ephemeral
`studentId = randomUUID()`.

**Phase 1**: the client sends `SessionJoinRequest.studentId` (the enrolled `Student.id`). The
server looks it up, validates `student.tenantId === session.tenantId`, and pre-fills
`displayName` from the profile.

```ts
// role === "student"
const { studentId } = req.body;
if (!studentId) return reply.code(400).send({ error: "INVALID_INPUT" });
const student = await identityService.getStudent(studentId);
if (!student) return reply.code(404).send({ error: "STUDENT_NOT_FOUND" });
if (student.tenantId !== session.tenantId) return reply.code(403).send({ error: "TENANT_MISMATCH" });
if (!session.students[studentId]) {
  session.students[studentId] = freshStudentState();
  session.students[studentId].displayName = student.displayName;
}
```

**No dual path.** A student join without a resolvable `studentId` is rejected — it is **not**
silently back-filled with an ephemeral id (that would be a hidden fallback; see AGENTS.md).
Assistants/teachers continue to join without `studentId`. MVP demos use a seeded **demo
tenant** with pre-enrolled students. `ClassSession` now carries a `tenantId` (set at session
creation, immutable — added to the frozen type in Phase 1) so the `403 TENANT_MISMATCH` check is
type-supported; its `students` map is keyed by the persistent `Student.id`. Wiring the session's
tenant from the room/class is the Step-5 implementation concern (the field and check are frozen
here; the demo deployment uses a single tenant).

**Child-facing reconciliation (binding).** The join-rejection paths above are
**operator-facing**: logged loudly and counted. They must reconcile with the AGENTS.md hard rule
*"no visible failure state for the child."* Per the degradation principle, a rejected join must
render to the child as a **warm non-failure** — an assistant-assisted retry / "找老师帮忙" /
waiting screen (owned by **Agent B**), **never** a raw error. This soft handling is **not** a
silent ephemeral student (no hidden fallback): the operator still sees the real
`400/404/403` + count; only the child sees warmth. Agent B owns the UX copy; Agent G owns the
loud operator signal.

---

## Failure modes

| Scenario | Behavior | Recovery |
| --- | --- | --- |
| Enroll under unknown parent | `404 PARENT_NOT_FOUND` | Create parent first. |
| Create parent under unknown tenant | `404 TENANT_NOT_FOUND` | Seed/select a valid tenant. |
| Duplicate parent (same phone/wechat in tenant) | `200` — returns the existing parent (idempotent) | Reuse the returned `parentId`. |
| Conflicting parent identifiers (match two parents) | `409 PARENT_ALREADY_EXISTS` | Operator resolves the duplicate out-of-band. |
| Age out of range | `400 INVALID_AGE` | Correct age (4–10). |
| Missing / unagreed consent | `400 CONSENT_REQUIRED` | Provide consent with `dataRetentionAgreed: true`. |
| Parent `PATCH` tries to set `geniusX`/`progress` | Ignored / `400 INVALID_INPUT` | Use the classroom path; parent cannot edit progress. |
| Student join without `studentId` | `400 INVALID_INPUT` | Send the enrolled `studentId`. |
| Student join, wrong tenant | `403 TENANT_MISMATCH` | Join the correct tenant's session. |
| Identity Service / DB down | Enrollment + student joins fail loudly (`5xx`) | **Does NOT affect an already-running classroom** (join is at the edge; runtime state is in Redis). Identity is required only at join time. |

> **Failure mode = does not affect a running classroom.** Identity is consulted at *join*, not
> per-interaction; a mid-class identity outage cannot interrupt the lesson flow. Enrollment and
> new joins fail loudly (operator-visible) rather than degrading silently.
>
> **Identity is a CORE dependency, not a shadow system.** Unlike Payload/Better-Auth/Langfuse/
> promptfoo (which AGENTS.md requires Lesson 1 to run without), Identity Service + PostgreSQL
> are required to *start* a Phase 1 class: a DB outage blocks all NEW joins. This is an
> intentional, owned availability coupling — the room-code/QR default still applies, but the
> code it resolves now points at an enrolled student. The loud operator-visible failure is by
> design; there is no shadow bypass here.

---

## Validation & preflight

Service-boundary validation (zod): age 4–10, non-empty `displayName`, semantic
`consentVersion`, `dataRetentionAgreed === true`, `studentId` present for student joins.

```bash
# Every student resolves to a valid parent and tenant (no orphans)
psql -c "SELECT COUNT(*) FROM students WHERE parent_id NOT IN (SELECT id FROM parents);"   # 0
psql -c "SELECT COUNT(*) FROM students WHERE tenant_id NOT IN (SELECT id FROM tenants);"   # 0
# Exactly one consent per student
psql -c "SELECT COUNT(*) FROM students s WHERE NOT EXISTS (SELECT 1 FROM guardian_consents gc WHERE gc.student_id = s.id);"  # 0
```

```ts
// Contract preflight: every IdentityErrorCode has a documented HTTP status (catches drift)
import type { IdentityErrorCode } from "@genius-x/contracts";
const STATUS: Record<IdentityErrorCode, number> = {
  STUDENT_NOT_FOUND: 404, PARENT_NOT_FOUND: 404, TENANT_NOT_FOUND: 404,
  TENANT_MISMATCH: 403, INVALID_AGE: 400, INVALID_INPUT: 400,
  CONSENT_REQUIRED: 400, PARENT_ALREADY_EXISTS: 409,
}; // exhaustive — a new code without a status fails typecheck
```

---

## Acceptance criteria

- All six endpoints implemented with the typed IO above; every error path returns an
  `IdentityErrorResponse` with the mapped status.
- Parent `PATCH` cannot mutate `geniusX`/`progress` (privilege boundary test).
- Classroom join uses persistent `studentId` with no ephemeral fallback; tenant mismatch ⇒ 403
  (unit test asserts the 403, since the check is application-level over a Redis session).
- `POST /parents` is idempotent on a plain duplicate (returns the existing parent, `200`).
- Join rejections are operator-loud but rendered to the child as a warm non-failure (Agent B).
- Preflight queries return 0; the `STATUS` map typechecks exhaustively.
- `pnpm --filter @genius-x/contracts typecheck` and the server test suite pass.

## Changelog

- **v1.1** (2026-06-11, lead-serialized — Step-4 review): unexpected (non-domain) errors
  return a sanitized `500 INTERNAL` — operator detail (name/code) is logged, never echoed
  to the client (workspace.md cites this rule). No request/response shape change.
- **v1** (2026-06-09): initial freeze.

---

_Enrollment Contract · Phase 1 · Frozen v1.1 · 2026-06-12_
