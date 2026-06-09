/**
 * Enrollment API types — contracts v1 (Phase 1).
 *
 * Typed realization of `docs/contracts/enrollment.md`. The request/response shapes for the
 * Identity Service HTTP surface, plus the API error registry.
 *
 * Endpoint map (implemented in `apps/server/src/identity`, Step 3/4):
 *   POST   /parents               → CreateParentRequest      → CreateParentResponse
 *   POST   /students              → EnrollStudentRequest     → EnrollStudentResponse
 *   GET    /students/:id          →                          → GetStudentResponse
 *   PATCH  /students/:id          → UpdateStudentRequest     → UpdateStudentResponse
 *   PATCH  /students/:id/consent  → UpdateConsentRequest     → UpdateConsentResponse
 *   GET    /tenants/:id/students  →                          → ListTenantStudentsResponse
 *
 * Pure TypeScript types only — the wire-level zod validation lives at the service boundary.
 */
import type { Student, GuardianConsent, GeniusXProfile, StudentProgress } from "./identity";

// --- POST /parents (create-or-return; idempotent on a matching identifier) ---

export interface CreateParentRequest {
  tenantId: string;
  wechatOpenId?: string;
  phoneNumber?: string;
}

/**
 * Returned for both a newly-created parent (`201`) and an existing match (`200`). POST /parents
 * is idempotent: if a parent already exists in the tenant for the supplied phone/wechat, its
 * `parentId` is returned (so the admin tool can enroll the next child under it) rather than
 * erroring. `PARENT_ALREADY_EXISTS` (`409`) is reserved for the ambiguous case where the
 * supplied identifiers match two *different* existing parents.
 */
export interface CreateParentResponse {
  parentId: string;
  tenantId: string;
}

// --- POST /students (parent-initiated enrollment) ---

/**
 * Guardian consent supplied at enrollment / consent update. The optional flags default to
 * `false` server-side when absent. `dataRetentionAgreed` must be `true` or enrollment is
 * rejected with CONSENT_REQUIRED.
 */
export interface ConsentInput {
  consentVersion: string;
  dataRetentionAgreed: boolean;
  parentCoWorkAllowed?: boolean; // default false
  mediaUsageAllowed?: boolean; // default false
}

export interface EnrollStudentRequest {
  parentId: string;
  displayName: string;
  age: number; // 4–10; out of range ⇒ INVALID_AGE
  consent: ConsentInput;
}

/** Enrollment returns the full persistent record (tenantId derived from the parent). */
export type EnrollStudentResponse = Student;

// --- GET /students/:id ---

export type GetStudentResponse = Student;

// --- PATCH /students/:id (parent-facing profile edit) ---

/**
 * Parent-facing profile update. Deliberately narrow: a parent may only edit `displayName`
 * and `age`. Companion state and progress are SERVER-OWNED (written by the Classroom Service
 * via {@link StudentProgressUpdate}) and are NOT mutable through this endpoint.
 */
export interface UpdateStudentRequest {
  displayName?: string;
  age?: number;
}

export type UpdateStudentResponse = Student;

/**
 * Server-internal student mutation applied by the Classroom Service after a stage/lesson
 * (e.g. avatar minted, lesson completed). NOT exposed via the parent HTTP API — kept here so
 * the shared mutation shape is contract-defined rather than redefined locally.
 */
export interface StudentProgressUpdate {
  geniusX?: Partial<GeniusXProfile>;
  progress?: Partial<StudentProgress>;
}

// --- PATCH /students/:id/consent ---

export type UpdateConsentRequest = ConsentInput;
export type UpdateConsentResponse = GuardianConsent;

// --- GET /tenants/:id/students (admin only) ---

/** Cursor pagination for the admin list (a tenant may hold up to ~10k students). */
export interface ListTenantStudentsQuery {
  limit?: number; // page size; server clamps to a max (e.g. 100)
  cursor?: string; // opaque cursor from a prior `nextCursor`; absent ⇒ first page
}

export interface ListTenantStudentsResponse {
  tenantId: string;
  students: Student[];
  nextCursor?: string; // opaque cursor for the next page; absent ⇒ last page
}

// --- Error registry (identity / enrollment API) ---

/**
 * Identity-API error codes. OPERATOR / parent-facing (returned over HTTP with the status
 * codes below) — distinct from the child-NEVER-sees `ErrorCode` registry in errors.ts.
 *
 * HTTP status mapping (enforced at the service boundary; see enrollment.md):
 *   STUDENT_NOT_FOUND      → 404
 *   PARENT_NOT_FOUND       → 404
 *   TENANT_NOT_FOUND       → 404
 *   TENANT_MISMATCH        → 403  (cross-tenant access attempt)
 *   INVALID_AGE            → 400  (age outside 4–10)
 *   INVALID_INPUT          → 400  (schema / validation failure)
 *   CONSENT_REQUIRED       → 400  (missing consent or dataRetentionAgreed !== true)
 *   PARENT_ALREADY_EXISTS  → 409  (AMBIGUOUS conflict only — supplied identifiers match two
 *                                  different parents; a plain duplicate is handled idempotently
 *                                  by POST /parents, see CreateParentResponse)
 */
export type IdentityErrorCode =
  | "STUDENT_NOT_FOUND"
  | "PARENT_NOT_FOUND"
  | "TENANT_NOT_FOUND"
  | "TENANT_MISMATCH"
  | "INVALID_AGE"
  | "INVALID_INPUT"
  | "CONSENT_REQUIRED"
  | "PARENT_ALREADY_EXISTS";

/** Uniform error body for every identity endpoint. `detail` is operator-facing only. */
export interface IdentityErrorResponse {
  error: IdentityErrorCode;
  detail?: string; // operator/debug context; never rendered to a child
}
