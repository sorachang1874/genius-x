/**
 * Identity Service (Phase 1, Step 3) — the typed realization of the frozen contracts:
 * docs/contracts/identity.md + enrollment.md, types from @genius-x/contracts.
 *
 * Error model: COMMANDS throw IdentityServiceError (typed code + HTTP status per the
 * enrollment.md mapping); the QUERY getStudent returns null for absence (the join path
 * maps null → 404 itself). `detail` is operator-facing only — never rendered to a child,
 * and never contains raw PII (no names/phone numbers in error text).
 *
 * Validation layering: this service enforces the SEMANTIC contract rules (age 4-10,
 * dataRetentionAgreed === true, consent-version format, non-empty name) so every caller —
 * HTTP route, classroom join, admin tool — gets them; the Step-4 zod schemas enforce wire
 * SHAPE at the HTTP boundary; the DB CHECKs/FKs are the final backstop.
 *
 * Atomicity without explicit transactions:
 *   - enrollStudent: ONE data-modifying CTE inserts student + guardian consent atomically.
 *   - updateConsent: ONE upsert keyed on the UNIQUE(student_id) row (overwrite semantics).
 *   - createParent: select-first, then INSERT ... ON CONFLICT DO NOTHING + re-select —
 *     race-safe idempotency without locks.
 */
import type {
  ConsentInput,
  CreateParentRequest,
  CreateParentResponse,
  EnrollStudentRequest,
  GuardianConsent,
  IdentityErrorCode,
  IdentityErrorResponse,
  ListTenantStudentsQuery,
  ListTenantStudentsResponse,
  Student,
  StudentProgressUpdate,
  UpdateStudentRequest,
} from "@genius-x/contracts";

/** Minimal query surface — pg.Pool satisfies it structurally; tests adapt PGlite. */
export interface IdentityDb {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Service result for createParent. `created` is ROUTE-INTERNAL: it drives the 201-vs-200
 * status choice and is NOT part of the frozen wire body — the Step-4 route must strip it
 * (`const { created, ...body } = result`) before replying with a CreateParentResponse.
 */
export interface CreateParentResult extends CreateParentResponse {
  created: boolean;
}

interface ParentMatchRow {
  id: string;
  wechat_open_id: string | null;
  phone_number: string | null;
}

/**
 * HTTP status per error code — the executable form of the enrollment.md preflight.
 * Exhaustive over IdentityErrorCode: adding a code without a status fails typecheck.
 */
export const IDENTITY_ERROR_STATUS: Record<IdentityErrorCode, number> = {
  STUDENT_NOT_FOUND: 404,
  PARENT_NOT_FOUND: 404,
  TENANT_NOT_FOUND: 404,
  TENANT_MISMATCH: 403,
  INVALID_AGE: 400,
  INVALID_INPUT: 400,
  CONSENT_REQUIRED: 400,
  PARENT_ALREADY_EXISTS: 409,
};

export class IdentityServiceError extends Error {
  constructor(
    readonly code: IdentityErrorCode,
    /** Operator-facing detail. Never shown to a child; never contains raw PII. */
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "IdentityServiceError";
  }
  get httpStatus(): number {
    return IDENTITY_ERROR_STATUS[this.code];
  }
  toResponse(): IdentityErrorResponse {
    return { error: this.code, ...(this.detail ? { detail: this.detail } : {}) };
  }
}

// --- validation (semantic contract rules; DB CHECKs are the backstop) ---

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Consent-policy version, e.g. "v1.0" / "v1.0.2" (identity.md: semantic version). */
const CONSENT_VERSION_RE = /^v\d+\.\d+(\.\d+)?$/;
const LIST_LIMIT_DEFAULT = 50;
const LIST_LIMIT_MAX = 100;
/** Upper bound for server-written companion text (e.g. birthdaySpeech) — ample for speech. */
const GENIUS_X_TEXT_MAX = 4096;

function requireUuid(value: string, what: string): void {
  if (!UUID_RE.test(value)) throw new IdentityServiceError("INVALID_INPUT", `${what} is not a UUID`);
}

/**
 * Normalize a parent identifier (the POST /parents idempotency keys): trimmed, non-empty.
 * Without trimming, " +86…" and "+86…" would be DISTINCT keys and quietly mint two parents
 * for the same family — defeating the UNIQUE(tenant_id, phone_number) dedup.
 */
function normalizeIdentifier(value: string | undefined, what: string): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") throw new IdentityServiceError("INVALID_INPUT", `${what} must be non-empty when provided`);
  return trimmed;
}

function requireAge(age: number): void {
  if (!Number.isInteger(age) || age < 4 || age > 10) {
    throw new IdentityServiceError("INVALID_AGE", `age must be an integer in 4-10, got ${age}`);
  }
}

const DISPLAY_NAME_MAX = 64;

function requireDisplayName(name: string): string {
  const trimmed = name.trim();
  // Mirrors the DB CHECK (btrim(display_name) <> '') — space-only is rejected too.
  if (trimmed === "") throw new IdentityServiceError("INVALID_INPUT", "displayName must be non-empty");
  if (trimmed.length > DISPLAY_NAME_MAX) {
    throw new IdentityServiceError("INVALID_INPUT", `displayName exceeds ${DISPLAY_NAME_MAX} characters`);
  }
  return trimmed;
}

function requireConsent(consent: ConsentInput | undefined): ConsentInput {
  if (!consent || consent.dataRetentionAgreed !== true) {
    throw new IdentityServiceError("CONSENT_REQUIRED", "dataRetentionAgreed must be true");
  }
  if (!CONSENT_VERSION_RE.test(consent.consentVersion)) {
    throw new IdentityServiceError("INVALID_INPUT", `consentVersion must match ${CONSENT_VERSION_RE}`);
  }
  return consent;
}

// --- row mapping (snake_case storage → camelCase contract) ---

const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

interface StudentRow {
  id: string;
  tenant_id: string;
  parent_id: string;
  display_name: string;
  age: number;
  enrolled_at: unknown;
  genius_x_name: string | null;
  genius_x_avatar_url: string | null;
  genius_x_personality_tag: string | null;
  genius_x_background_setting: string | null;
  genius_x_birthday_speech: string | null;
  completed_lesson_ids: string[];
  current_phase: number;
  badges: string[];
  created_at: unknown;
  updated_at: unknown;
}

function toStudent(row: StudentRow): Student {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    parentId: row.parent_id,
    displayName: row.display_name,
    age: row.age,
    enrolledAt: iso(row.enrolled_at),
    geniusX: {
      ...(row.genius_x_name !== null && { name: row.genius_x_name }),
      ...(row.genius_x_avatar_url !== null && { avatarUrl: row.genius_x_avatar_url }),
      ...(row.genius_x_personality_tag !== null && { personalityTag: row.genius_x_personality_tag }),
      ...(row.genius_x_background_setting !== null && { backgroundSetting: row.genius_x_background_setting }),
      ...(row.genius_x_birthday_speech !== null && { birthdaySpeech: row.genius_x_birthday_speech }),
    },
    progress: {
      completedLessonIds: row.completed_lesson_ids,
      currentPhase: row.current_phase,
      badges: row.badges,
    },
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

interface ConsentRow {
  student_id: string;
  parent_id: string;
  consent_given_at: unknown;
  consent_version: string;
  data_retention_agreed: boolean;
  parent_co_work_allowed: boolean;
  media_usage_allowed: boolean;
}

function toConsent(row: ConsentRow): GuardianConsent {
  return {
    studentId: row.student_id,
    parentId: row.parent_id,
    consentGivenAt: iso(row.consent_given_at),
    consentVersion: row.consent_version,
    dataRetentionAgreed: row.data_retention_agreed,
    parentCoWorkAllowed: row.parent_co_work_allowed,
    mediaUsageAllowed: row.media_usage_allowed,
  };
}

// --- cursor encoding (opaque on the wire; internally the last student id) ---

function encodeCursor(lastId: string): string {
  return Buffer.from(lastId, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (!UUID_RE.test(decoded)) throw new IdentityServiceError("INVALID_INPUT", "invalid cursor");
  return decoded;
}

const STUDENT_COLUMNS = `id, tenant_id, parent_id, display_name, age, enrolled_at,
  genius_x_name, genius_x_avatar_url, genius_x_personality_tag, genius_x_background_setting,
  genius_x_birthday_speech, completed_lesson_ids, current_phase, badges, created_at, updated_at`;

export class IdentityService {
  constructor(private readonly db: IdentityDb) {}

  /**
   * Create-or-return (idempotent per enrollment.md): a plain duplicate of a provided
   * phone/wechat within the tenant returns the EXISTING parent (`created: false` → 200);
   * 409 PARENT_ALREADY_EXISTS only when the identifiers match two DIFFERENT parents.
   *
   * On an idempotent match the identifiers are RECONCILED, never silently dropped
   * (AGENTS.md: no invisible degraded path): a supplied identifier the stored row lacks is
   * backfilled (the owner matrix marks these fields editable); a supplied identifier that
   * CONTRADICTS a stored value keeps the stored value and logs operator-visibly (ids only —
   * no raw phone/wechat values in logs per the privacy contract).
   *
   * Tenants with status 'archived' refuse new parents (TENANT_NOT_FOUND); 'suspended' is
   * advisory in Phase 1 (no contract semantics defined yet).
   */
  async createParent(req: CreateParentRequest): Promise<CreateParentResult> {
    requireUuid(req.tenantId, "tenantId");
    const wechat = normalizeIdentifier(req.wechatOpenId, "wechatOpenId");
    const phone = normalizeIdentifier(req.phoneNumber, "phoneNumber");

    const tenant = await this.db.query("SELECT 1 FROM tenants WHERE id = $1 AND status <> 'archived'", [
      req.tenantId,
    ]);
    if (tenant.rows.length === 0) throw new IdentityServiceError("TENANT_NOT_FOUND");

    const findExisting = async (): Promise<ParentMatchRow | null> => {
      if (wechat === null && phone === null) return null; // no idempotency key → always create
      const matches = await this.db.query(
        `SELECT id, wechat_open_id, phone_number FROM parents
         WHERE tenant_id = $1
           AND ((wechat_open_id IS NOT NULL AND wechat_open_id = $2)
             OR (phone_number  IS NOT NULL AND phone_number  = $3))`,
        [req.tenantId, wechat, phone],
      );
      if (matches.rows.length > 1) {
        throw new IdentityServiceError(
          "PARENT_ALREADY_EXISTS",
          "identifiers match two different parents in this tenant",
        );
      }
      return matches.rows.length === 1 ? (matches.rows[0] as ParentMatchRow) : null;
    };

    const resolveExisting = async (row: ParentMatchRow): Promise<CreateParentResult> => {
      await this.reconcileParentIdentifiers(row, wechat, phone);
      return { parentId: row.id, tenantId: req.tenantId, created: false };
    };

    const existing = await findExisting();
    if (existing) return resolveExisting(existing);

    const inserted = await this.db.query(
      `INSERT INTO parents (tenant_id, wechat_open_id, phone_number) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [req.tenantId, wechat, phone],
    );
    if (inserted.rows.length === 1) {
      return { parentId: (inserted.rows[0] as { id: string }).id, tenantId: req.tenantId, created: true };
    }
    // Lost a race to a concurrent create — the duplicate now exists; re-resolve it.
    const raced = await findExisting();
    if (raced) return resolveExisting(raced);
    throw new IdentityServiceError("PARENT_ALREADY_EXISTS", "conflicting concurrent parent creation");
  }

  /**
   * Identifier reconciliation on an idempotent match — operator-visible, never silent.
   * Backfills identifiers the stored row lacks; logs (ids + field names ONLY, never raw
   * identifier values) when a supplied identifier contradicts a stored one or a backfill
   * loses a race to a conflicting parent.
   */
  private async reconcileParentIdentifiers(row: ParentMatchRow, wechat: string | null, phone: string | null): Promise<void> {
    const note = (field: string, what: string): void => {
      console.warn(`[identity] createParent ${what}: parent=${row.id} field=${field}`);
    };
    const reconcile = async (field: string, column: "wechat_open_id" | "phone_number", supplied: string | null, stored: string | null): Promise<void> => {
      if (supplied === null) return;
      if (stored === null) {
        try {
          await this.db.query(`UPDATE parents SET ${column} = COALESCE(${column}, $2) WHERE id = $1`, [row.id, supplied]);
          note(field, "identifier-backfilled");
        } catch {
          // e.g. a concurrent parent now owns this identifier (unique constraint).
          note(field, "identifier-backfill-failed (operator: resolve duplicate)");
        }
      } else if (stored !== supplied) {
        note(field, "identifier-contradiction (stored value kept)");
      }
    };
    await reconcile("wechatOpenId", "wechat_open_id", wechat, row.wechat_open_id);
    await reconcile("phoneNumber", "phone_number", phone, row.phone_number);
  }

  /**
   * Enroll a student under a parent: ONE atomic statement (data-modifying CTE) creates the
   * student AND its guardian-consent row; tenantId derives from the parent. Returns the
   * full persistent Student (EnrollStudentResponse = Student). Archived tenants refuse
   * new enrollments (TENANT_NOT_FOUND); 'suspended' is advisory in Phase 1.
   */
  async enrollStudent(req: EnrollStudentRequest): Promise<Student> {
    requireUuid(req.parentId, "parentId");
    const displayName = requireDisplayName(req.displayName);
    requireAge(req.age);
    const consent = requireConsent(req.consent);

    const result = await this.db.query(
      `WITH new_student AS (
         INSERT INTO students (tenant_id, parent_id, display_name, age)
         SELECT p.tenant_id, p.id, $2, $3
         FROM parents p JOIN tenants t ON t.id = p.tenant_id AND t.status <> 'archived'
         WHERE p.id = $1
         RETURNING *
       ), new_consent AS (
         INSERT INTO guardian_consents
           (student_id, parent_id, consent_version, data_retention_agreed, parent_co_work_allowed, media_usage_allowed)
         SELECT ns.id, ns.parent_id, $4, $5, $6, $7 FROM new_student ns
         RETURNING student_id
       )
       SELECT ns.* FROM new_student ns, new_consent nc`,
      [
        req.parentId,
        displayName,
        req.age,
        consent.consentVersion,
        consent.dataRetentionAgreed,
        consent.parentCoWorkAllowed ?? false,
        consent.mediaUsageAllowed ?? false,
      ],
    );
    if (result.rows.length === 0) {
      // Disambiguate (failure path only): missing parent vs archived tenant.
      const parent = await this.db.query("SELECT 1 FROM parents WHERE id = $1", [req.parentId]);
      if (parent.rows.length === 0) throw new IdentityServiceError("PARENT_NOT_FOUND");
      throw new IdentityServiceError("TENANT_NOT_FOUND", "tenant is archived — enrollment refused");
    }
    return toStudent(result.rows[0] as StudentRow);
  }

  /**
   * Query: returns null ONLY for a well-formed-but-absent id (the classroom join maps
   * null → 404 itself); a MALFORMED id throws INVALID_INPUT — join callers must catch
   * IdentityServiceError and map err.httpStatus (the enrollment.md join snippet's bare
   * falsy check is illustrative, not sufficient).
   */
  async getStudent(studentId: string): Promise<Student | null> {
    requireUuid(studentId, "studentId");
    const result = await this.db.query(`SELECT ${STUDENT_COLUMNS} FROM students WHERE id = $1`, [studentId]);
    return result.rows.length === 0 ? null : toStudent(result.rows[0] as StudentRow);
  }

  /**
   * Parent-facing profile edit — deliberately narrow allowlist (displayName, age).
   * Companion state and progress are server-owned: see applyProgressUpdate.
   *
   * The service IGNORES extra keys (it only ever reads the allowlist), so STRICT rejection
   * of smuggled keys (`geniusX`, `progress`, …) is the route's obligation — the Step-4 zod
   * schema is strictObject for exactly this reason (enrollment.md owner matrix: "rejects
   * keys outside the allowlist").
   */
  async updateStudent(studentId: string, updates: UpdateStudentRequest): Promise<Student> {
    requireUuid(studentId, "studentId");
    const sets: string[] = [];
    const params: unknown[] = [studentId];
    if (updates.displayName !== undefined) {
      params.push(requireDisplayName(updates.displayName));
      sets.push(`display_name = $${params.length}`);
    }
    if (updates.age !== undefined) {
      requireAge(updates.age);
      params.push(updates.age);
      sets.push(`age = $${params.length}`);
    }
    if (sets.length === 0) throw new IdentityServiceError("INVALID_INPUT", "no updatable fields provided");

    const result = await this.db.query(
      `UPDATE students SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING ${STUDENT_COLUMNS}`,
      params,
    );
    if (result.rows.length === 0) throw new IdentityServiceError("STUDENT_NOT_FOUND");
    return toStudent(result.rows[0] as StudentRow);
  }

  /**
   * Overwrite the student's single consent row to a new version (UNIQUE(student_id);
   * prior version not retained — audit log is a documented future extension). The
   * consenting parent is always the student's own parent (guardianship composite FK).
   */
  async updateConsent(studentId: string, consent: ConsentInput): Promise<GuardianConsent> {
    requireUuid(studentId, "studentId");
    const valid = requireConsent(consent);

    const result = await this.db.query(
      `INSERT INTO guardian_consents
         (student_id, parent_id, consent_version, data_retention_agreed, parent_co_work_allowed, media_usage_allowed, consent_given_at)
       SELECT s.id, s.parent_id, $2, $3, $4, $5, NOW() FROM students s WHERE s.id = $1
       ON CONFLICT (student_id) DO UPDATE SET
         parent_id              = EXCLUDED.parent_id,
         consent_version        = EXCLUDED.consent_version,
         data_retention_agreed  = EXCLUDED.data_retention_agreed,
         parent_co_work_allowed = EXCLUDED.parent_co_work_allowed,
         media_usage_allowed    = EXCLUDED.media_usage_allowed,
         consent_given_at       = EXCLUDED.consent_given_at
       RETURNING *`,
      [studentId, valid.consentVersion, valid.dataRetentionAgreed, valid.parentCoWorkAllowed ?? false, valid.mediaUsageAllowed ?? false],
    );
    if (result.rows.length === 0) throw new IdentityServiceError("STUDENT_NOT_FOUND");
    return toConsent(result.rows[0] as ConsentRow);
  }

  /**
   * SERVER-INTERNAL (Classroom Service after stages/lessons) — never exposed through the
   * parent HTTP API. Partial merge: provided fields replace; absent fields keep.
   *
   * This path has NO zod backstop, so it validates its own inputs to typed errors — a raw
   * DB error here would carry row contents (the child's display name) into err.detail,
   * violating the no-raw-PII-in-logs contract.
   */
  async applyProgressUpdate(studentId: string, update: StudentProgressUpdate): Promise<Student> {
    requireUuid(studentId, "studentId");
    const sets: string[] = [];
    const params: unknown[] = [studentId];
    const set = (column: string, value: unknown, cast = ""): void => {
      params.push(value);
      sets.push(`${column} = $${params.length}${cast}`);
    };
    const requireBoundedText = (value: string, field: string): string => {
      if (value.length > GENIUS_X_TEXT_MAX) {
        throw new IdentityServiceError("INVALID_INPUT", `${field} exceeds ${GENIUS_X_TEXT_MAX} characters`);
      }
      return value;
    };
    const requireStringArray = (value: unknown, field: string): unknown => {
      if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) {
        throw new IdentityServiceError("INVALID_INPUT", `${field} must be string[]`);
      }
      return value;
    };

    const g = update.geniusX ?? {};
    if (g.name !== undefined) set("genius_x_name", requireBoundedText(g.name, "geniusX.name"));
    if (g.avatarUrl !== undefined) set("genius_x_avatar_url", requireBoundedText(g.avatarUrl, "geniusX.avatarUrl"));
    if (g.personalityTag !== undefined) set("genius_x_personality_tag", requireBoundedText(g.personalityTag, "geniusX.personalityTag"));
    if (g.backgroundSetting !== undefined) set("genius_x_background_setting", requireBoundedText(g.backgroundSetting, "geniusX.backgroundSetting"));
    if (g.birthdaySpeech !== undefined) set("genius_x_birthday_speech", requireBoundedText(g.birthdaySpeech, "geniusX.birthdaySpeech"));

    const p = update.progress ?? {};
    if (p.completedLessonIds !== undefined) set("completed_lesson_ids", requireStringArray(p.completedLessonIds, "progress.completedLessonIds"), "::text[]");
    if (p.badges !== undefined) set("badges", requireStringArray(p.badges, "progress.badges"), "::text[]");
    if (p.currentPhase !== undefined) {
      if (!Number.isInteger(p.currentPhase) || p.currentPhase < 1 || p.currentPhase > 4) {
        throw new IdentityServiceError("INVALID_INPUT", `currentPhase must be 1-4, got ${p.currentPhase}`);
      }
      set("current_phase", p.currentPhase);
    }

    if (sets.length === 0) throw new IdentityServiceError("INVALID_INPUT", "no progress fields provided");

    const result = await this.db.query(
      `UPDATE students SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $1 RETURNING ${STUDENT_COLUMNS}`,
      params,
    );
    if (result.rows.length === 0) throw new IdentityServiceError("STUDENT_NOT_FOUND");
    return toStudent(result.rows[0] as StudentRow);
  }

  /**
   * Admin-only listing (operator convention in Phase 1; auth is Phase 3). Cursor-keyset
   * pagination ordered by id — `nextCursor` absent on the last page.
   *
   * Caveats (intentional Phase-1 semantics):
   *   - Keyset over random v4 UUIDs: a student enrolled MID-WALK whose id sorts below the
   *     cursor appears only on the next listing (standard cursor semantics; self-healing).
   *   - READS from archived tenants are allowed (operators must still see their data);
   *     only WRITES (new parents/enrollments) are refused.
   */
  async listTenantStudents(tenantId: string, query: ListTenantStudentsQuery = {}): Promise<ListTenantStudentsResponse> {
    requireUuid(tenantId, "tenantId");
    const tenant = await this.db.query("SELECT 1 FROM tenants WHERE id = $1", [tenantId]);
    if (tenant.rows.length === 0) throw new IdentityServiceError("TENANT_NOT_FOUND");

    if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) {
      throw new IdentityServiceError("INVALID_INPUT", "limit must be a positive integer");
    }
    const limit = Math.min(query.limit ?? LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX);
    const after = query.cursor !== undefined ? decodeCursor(query.cursor) : null;

    // limit+1 to detect whether a further page exists without a second query.
    const result = await this.db.query(
      `SELECT ${STUDENT_COLUMNS} FROM students
       WHERE tenant_id = $1 AND ($2::uuid IS NULL OR id > $2)
       ORDER BY id
       LIMIT $3`,
      [tenantId, after, limit + 1],
    );
    const rows = result.rows as StudentRow[];
    const page = rows.slice(0, limit);
    const students = page.map(toStudent);
    return {
      tenantId,
      students,
      ...(rows.length > limit && page.length > 0 ? { nextCursor: encodeCursor(page[page.length - 1]!.id) } : {}),
    };
  }
}
