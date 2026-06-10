/**
 * Workspace Service (Phase 2, Step 3) — typed realization of docs/contracts/workspace.md.
 *
 * WRITES are SERVER-INTERNAL (the Classroom Service calls them in-process, fire-and-forget;
 * never exposed over HTTP in Phase 2 — the privilege boundary). READS back the HTTP API.
 *
 * Tenant isolation: `tenantId` is ALWAYS derived from the student row inside the INSERT
 * (`SELECT s.id, s.tenant_id FROM students s WHERE s.id = $1`) — callers cannot supply it,
 * and the composite FK works/interactions/memories(student_id, tenant_id) →
 * students(id, tenant_id) backstops at the data layer.
 *
 * Lesson-declared vocabularies (`declaredArtifactTypes` / `declaredMemoryKeys`) are
 * validated HERE when the caller passes them (the classroom owns the lesson config; the
 * service stays lesson-agnostic): an undeclared type/key is rejected INVALID_INPUT — the
 * contract's "write rejected" rule.
 *
 * Error model mirrors IdentityService: typed WorkspaceServiceError with the exhaustive
 * status map; reads return null only where the route maps 404 itself (getWork/getSummary
 * throw — they are the route surface).
 */
import type {
  InteractionRecord,
  ListInteractionsResponse,
  ListMemoriesResponse,
  ListWorksResponse,
  RecordInteractionRequest,
  RecordMemoryRequest,
  RecordWorkRequest,
  StudentMemory,
  Work,
  WorkspaceErrorCode,
  WorkspaceErrorResponse,
  WorkspaceListQuery,
  WorkspaceSummaryResponse,
} from "@genius-x/contracts";
import { EPISODE_MEMORY_KEY, parseEpisodeValue } from "@genius-x/contracts";
import type { IdentityDb } from "../identity/service";

export const WORKSPACE_ERROR_STATUS: Record<WorkspaceErrorCode, number> = {
  STUDENT_NOT_FOUND: 404,
  WORK_NOT_FOUND: 404,
  INVALID_INPUT: 400,
};

export class WorkspaceServiceError extends Error {
  constructor(
    readonly code: WorkspaceErrorCode,
    /** Operator-facing detail. Never shown to a child; never raw PII. */
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "WorkspaceServiceError";
  }
  get httpStatus(): number {
    return WORKSPACE_ERROR_STATUS[this.code];
  }
  toResponse(): WorkspaceErrorResponse {
    return { error: this.code, ...(this.detail ? { detail: this.detail } : {}) };
  }
}

// --- validation bounds (workspace.md → Validation) ---

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_MAX = 2048;
const REF_MAX = 512;
const TEXT_MAX = 65536;
const MEMORY_VALUE_MAX = 4096;
const CONTENT_JSON_MAX = 65536; // bytes-ish (JSON string length) — blobs can't bypass refs-never-bytes
const AI_PARAMS_MAX = 16384;
const LIST_LIMIT_DEFAULT = 20;
const LIST_LIMIT_MAX = 100;

function requireUuid(value: string, what: string): void {
  if (!UUID_RE.test(value)) throw new WorkspaceServiceError("INVALID_INPUT", `${what} is not a UUID`);
}

function requireBounded(value: string | undefined, max: number, what: string): void {
  if (value === undefined) return;
  if (value === "" || value.length > max) {
    throw new WorkspaceServiceError("INVALID_INPUT", `${what} must be non-empty and <= ${max} chars`);
  }
}

function requireNonEmpty(value: string, max: number, what: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > max) {
    throw new WorkspaceServiceError("INVALID_INPUT", `${what} must be non-empty and <= ${max} chars`);
  }
  return trimmed;
}

function requireIso(value: string, what: string): void {
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new WorkspaceServiceError("INVALID_INPUT", `${what} is not an ISO timestamp`);
  // Mirror the DB sanity CHECK (clock-skew guard) so rejection stays typed, pre-DB.
  if (t < Date.parse("2024-01-01T00:00:00Z") || t > Date.now() + 24 * 3600 * 1000) {
    throw new WorkspaceServiceError("INVALID_INPUT", `${what} is outside the sane clock window`);
  }
}

/** The DB backstop fired anyway (service drift): surface check violations TYPED, not raw. */
function mapDbBackstop(err: unknown): never {
  const e = err as { code?: string; constraint?: string; message?: string };
  if (e?.code === "23514" || /check constraint/i.test(String(e?.message))) {
    throw new WorkspaceServiceError("INVALID_INPUT", `DB check rejected the write (${e?.constraint ?? "unknown constraint"})`);
  }
  throw err;
}

/** Vocabulary check for lesson-declared opaque ids ("write rejected" contract rule). */
function requireDeclared(value: string, declared: readonly string[] | undefined, what: string): void {
  if (declared && !declared.includes(value)) {
    throw new WorkspaceServiceError("INVALID_INPUT", `${what} "${value}" is not declared by the lesson`);
  }
}

// --- recency/importance keyset cursors (opaque on the wire) ---

const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/**
 * Cursor-only MICROSECOND-precise timestamp (strict ISO). Drivers hand back Date objects
 * truncated to milliseconds — encoding those into the cursor makes the keyset comparison
 * exclude same-millisecond rows with microsecond residue (silent row SKIPS on real PG,
 * where NOW() always carries microseconds; PGlite's ms-aligned NOW() masks it in tests).
 */
const CURSOR_TS = (alias: string): string =>
  `to_char(${alias}.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor`;

function encodeCursor(parts: string[]): string {
  return Buffer.from(parts.join("|"), "utf8").toString("base64url");
}

function decodeCursor(cursor: string, arity: number): string[] {
  const parts = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (parts.length !== arity || !UUID_RE.test(parts[parts.length - 1]!) || Number.isNaN(Date.parse(parts[arity - 2]!))) {
    throw new WorkspaceServiceError("INVALID_INPUT", "invalid cursor");
  }
  return parts;
}

function clampLimit(query: WorkspaceListQuery): number {
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) {
    throw new WorkspaceServiceError("INVALID_INPUT", "limit must be a positive integer");
  }
  return Math.min(query.limit ?? LIST_LIMIT_DEFAULT, LIST_LIMIT_MAX);
}

// --- row mapping ---

interface WorkRow {
  id: string; student_id: string; tenant_id: string; type: string;
  content_url: string | null; content_text: string | null; content_json: Record<string, unknown> | null;
  thumbnail_url: string | null; lesson_id: string; stage_id: string; session_id: string | null;
  ai_params: Record<string, unknown> | null; degraded: boolean; created_at: unknown;
}

function toWork(r: WorkRow): Work {
  return {
    id: r.id,
    studentId: r.student_id,
    tenantId: r.tenant_id,
    type: r.type,
    ...(r.content_url !== null && { contentUrl: r.content_url }),
    ...(r.content_text !== null && { contentText: r.content_text }),
    ...(r.content_json !== null && { contentJson: r.content_json }),
    ...(r.thumbnail_url !== null && { thumbnailUrl: r.thumbnail_url }),
    metadata: {
      lessonId: r.lesson_id,
      stageId: r.stage_id,
      ...(r.session_id !== null && { sessionId: r.session_id }),
      ...(r.ai_params !== null && { aiParams: r.ai_params }),
      degraded: r.degraded,
    },
    createdAt: iso(r.created_at),
  };
}

interface InteractionRow {
  id: string; student_id: string; tenant_id: string; occurred_at: unknown;
  lesson_id: string; stage_id: string; session_id: string | null; initiated_by: "student" | "parent";
  input_kind: string; input_ref: string | null; input_text: string | null;
  output_kind: string; output_ref: string | null; output_text: string | null;
  output_work_id: string | null; output_degraded: boolean;
  safety: "ok" | "input_filtered" | "output_filtered";
  memories_extracted: string[]; created_at: unknown;
}

function toInteraction(r: InteractionRow): InteractionRecord {
  return {
    id: r.id,
    studentId: r.student_id,
    tenantId: r.tenant_id,
    occurredAt: iso(r.occurred_at),
    context: {
      lessonId: r.lesson_id,
      stageId: r.stage_id,
      ...(r.session_id !== null && { sessionId: r.session_id }),
      initiatedBy: r.initiated_by,
    },
    input: {
      kind: r.input_kind,
      ...(r.input_ref !== null && { contentRef: r.input_ref }),
      ...(r.input_text !== null && { text: r.input_text }),
    },
    output: {
      kind: r.output_kind,
      ...(r.output_ref !== null && { contentRef: r.output_ref }),
      ...(r.output_text !== null && { text: r.output_text }),
      ...(r.output_work_id !== null && { workId: r.output_work_id }),
      degraded: r.output_degraded,
    },
    memoriesExtracted: r.memories_extracted,
    safety: r.safety,
    createdAt: iso(r.created_at),
  };
}

interface MemoryRow {
  id: string; student_id: string; tenant_id: string; key: string; value: string;
  lesson_id: string; stage_id: string; session_id: string | null; source_interaction_id: string | null;
  importance: number; last_accessed_at: unknown; access_count: number; created_at: unknown;
}

function toMemory(r: MemoryRow): StudentMemory {
  return {
    id: r.id,
    studentId: r.student_id,
    tenantId: r.tenant_id,
    key: r.key,
    value: r.value,
    context: {
      lessonId: r.lesson_id,
      stageId: r.stage_id,
      ...(r.session_id !== null && { sessionId: r.session_id }),
      ...(r.source_interaction_id !== null && { sourceInteractionId: r.source_interaction_id }),
    },
    importance: r.importance,
    lastAccessedAt: iso(r.last_accessed_at),
    accessCount: r.access_count,
    createdAt: iso(r.created_at),
  };
}

const WORK_COLUMNS = `id, student_id, tenant_id, type, content_url, content_text, content_json,
  thumbnail_url, lesson_id, stage_id, session_id, ai_params, degraded, created_at`;
const INTERACTION_COLUMNS = `id, student_id, tenant_id, occurred_at, lesson_id, stage_id, session_id,
  initiated_by, input_kind, input_ref, input_text, output_kind, output_ref, output_text,
  output_work_id, output_degraded, safety, memories_extracted, created_at`;
const MEMORY_COLUMNS = `id, student_id, tenant_id, key, value, lesson_id, stage_id, session_id,
  source_interaction_id, importance, last_accessed_at, access_count, created_at`;

/** Lesson vocabularies the classroom caller passes so writes are validated against config. */
export interface LessonVocabulary {
  declaredArtifactTypes?: readonly string[];
  declaredMemoryKeys?: readonly string[];
}

export class WorkspaceService {
  constructor(private readonly db: IdentityDb) {}

  // --- server-internal writes (Classroom Service only; NOT exposed over HTTP) ---

  async recordWork(req: RecordWorkRequest, vocab: LessonVocabulary = {}): Promise<Work> {
    requireUuid(req.studentId, "studentId");
    const type = requireNonEmpty(req.type, 200, "type");
    requireDeclared(type, vocab.declaredArtifactTypes, "artifact type");
    requireBounded(req.contentUrl, URL_MAX, "contentUrl");
    requireBounded(req.contentText, TEXT_MAX, "contentText");
    requireBounded(req.thumbnailUrl, URL_MAX, "thumbnailUrl");
    if (req.contentUrl === undefined && req.contentText === undefined && req.contentJson === undefined) {
      throw new WorkspaceServiceError("INVALID_INPUT", "a work needs contentUrl, contentText or contentJson");
    }
    // BYTES, not UTF-16 code units (CJK = 3 bytes/char): mirror pg_column_size with headroom.
    if (req.contentJson !== undefined && Buffer.byteLength(JSON.stringify(req.contentJson), "utf8") > CONTENT_JSON_MAX - 1024) {
      throw new WorkspaceServiceError("INVALID_INPUT", `contentJson exceeds ${CONTENT_JSON_MAX} bytes`);
    }
    if (req.metadata.aiParams !== undefined && Buffer.byteLength(JSON.stringify(req.metadata.aiParams), "utf8") > AI_PARAMS_MAX - 1024) {
      throw new WorkspaceServiceError("INVALID_INPUT", `metadata.aiParams exceeds ${AI_PARAMS_MAX} bytes`);
    }
    const m = req.metadata;
    const lessonId = requireNonEmpty(m.lessonId, 200, "metadata.lessonId");
    const stageId = requireNonEmpty(m.stageId, 200, "metadata.stageId");
    requireBounded(m.sessionId, 128, "metadata.sessionId");

    let result: { rows: unknown[] };
    try {
      result = await this.db.query(
        `INSERT INTO works (student_id, tenant_id, type, content_url, content_text, content_json,
                            thumbnail_url, lesson_id, stage_id, session_id, ai_params, degraded)
         SELECT s.id, s.tenant_id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
         FROM students s WHERE s.id = $1
         RETURNING ${WORK_COLUMNS}`,
        [
          req.studentId, type,
          req.contentUrl ?? null, req.contentText ?? null,
          req.contentJson !== undefined ? JSON.stringify(req.contentJson) : null,
          req.thumbnailUrl ?? null,
          lessonId, stageId, m.sessionId ?? null,
          m.aiParams !== undefined ? JSON.stringify(m.aiParams) : null,
          m.degraded,
        ],
      );
    } catch (err) {
      mapDbBackstop(err);
    }
    if (result.rows.length === 0) throw new WorkspaceServiceError("STUDENT_NOT_FOUND");
    return toWork(result.rows[0] as WorkRow);
  }

  async recordInteraction(req: RecordInteractionRequest): Promise<InteractionRecord> {
    requireUuid(req.studentId, "studentId");
    requireIso(req.occurredAt, "occurredAt");
    const ctxLessonId = requireNonEmpty(req.context.lessonId, 200, "context.lessonId");
    const ctxStageId = requireNonEmpty(req.context.stageId, 200, "context.stageId");
    const inputKind = requireNonEmpty(req.input.kind, 100, "input.kind");
    const outputKind = requireNonEmpty(req.output.kind, 100, "output.kind");
    requireBounded(req.context.sessionId, 128, "context.sessionId");
    requireBounded(req.input.contentRef, REF_MAX, "input.contentRef");
    requireBounded(req.output.contentRef, REF_MAX, "output.contentRef");
    if ((req.input.text?.length ?? 0) > TEXT_MAX || (req.output.text?.length ?? 0) > TEXT_MAX) {
      throw new WorkspaceServiceError("INVALID_INPUT", `text exceeds ${TEXT_MAX} chars`);
    }
    if (req.input.text === "" || req.output.text === "") {
      throw new WorkspaceServiceError("INVALID_INPUT", "empty text must be omitted, not sent as ''");
    }
    if (req.output.workId !== undefined) requireUuid(req.output.workId, "output.workId");

    let result: { rows: unknown[] };
    try {
      result = await this.db.query(
        `INSERT INTO interactions (student_id, tenant_id, occurred_at, lesson_id, stage_id, session_id,
                                   initiated_by, input_kind, input_ref, input_text,
                                   output_kind, output_ref, output_text, output_work_id, output_degraded, safety)
         SELECT s.id, s.tenant_id, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
         FROM students s WHERE s.id = $1
         RETURNING ${INTERACTION_COLUMNS}`,
        [
          req.studentId, req.occurredAt,
          ctxLessonId, ctxStageId, req.context.sessionId ?? null,
          req.context.initiatedBy,
          inputKind, req.input.contentRef ?? null, req.input.text ?? null,
          outputKind, req.output.contentRef ?? null, req.output.text ?? null,
          req.output.workId ?? null, req.output.degraded, req.safety ?? "ok",
        ],
      );
    } catch (err) {
      mapDbBackstop(err);
    }
    if (result.rows.length === 0) throw new WorkspaceServiceError("STUDENT_NOT_FOUND");
    return toInteraction(result.rows[0] as InteractionRow);
  }

  /**
   * Record a memory; when `sourceInteractionId` is present, atomically (one statement)
   * appends the new memory id into that interaction's `memoriesExtracted` — the contract's
   * "filled async" update path lives HERE, nowhere else.
   */
  async recordMemory(req: RecordMemoryRequest, vocab: LessonVocabulary = {}): Promise<StudentMemory> {
    requireUuid(req.studentId, "studentId");
    const key = requireNonEmpty(req.key, 200, "key");
    if (key === EPISODE_MEMORY_KEY) {
      // workspace.md v1.1 carve-out (agent-context.md): the RESERVED episodic kind is
      // validated by SCHEMA (the same parseEpisodeValue the gateway uses), never by the
      // lesson vocabulary — and a lesson can never DECLARE it (validator fails closed).
      if (parseEpisodeValue(req.value) === null) {
        throw new WorkspaceServiceError("INVALID_INPUT", "episode value violates the EpisodeValue schema");
      }
    } else {
      requireDeclared(key, vocab.declaredMemoryKeys, "memory key");
    }
    const value = requireNonEmpty(req.value, MEMORY_VALUE_MAX, "value");
    const memLessonId = requireNonEmpty(req.context.lessonId, 200, "context.lessonId");
    const memStageId = requireNonEmpty(req.context.stageId, 200, "context.stageId");
    requireBounded(req.context.sessionId, 128, "context.sessionId");
    if (req.importance !== undefined && (req.importance < 0 || req.importance > 1)) {
      throw new WorkspaceServiceError("INVALID_INPUT", "importance must be in [0,1]");
    }
    if (req.context.sourceInteractionId !== undefined) requireUuid(req.context.sourceInteractionId, "sourceInteractionId");

    let result: { rows: unknown[] };
    try {
      result = await this.db.query(
      `WITH new_memory AS (
         INSERT INTO memories (student_id, tenant_id, key, value, lesson_id, stage_id, session_id,
                               source_interaction_id, importance)
         SELECT s.id, s.tenant_id, $2, $3, $4, $5, $6, $7, $8
         FROM students s WHERE s.id = $1
         RETURNING ${MEMORY_COLUMNS}
       ), linked AS (
         UPDATE interactions i
         SET memories_extracted = array_append(i.memories_extracted, nm.id)
         FROM new_memory nm
         WHERE i.id = nm.source_interaction_id
           AND i.student_id = nm.student_id  -- SAME-student only (defense in depth; the
                                             -- composite FK already rejects cross-student)
         RETURNING i.id
       )
       SELECT nm.* FROM new_memory nm`,
      [
        req.studentId, key, value,
        memLessonId, memStageId, req.context.sessionId ?? null,
        req.context.sourceInteractionId ?? null,
        req.importance ?? 0.5,
      ],
      );
    } catch (err) {
      // CONSTRAINT-specific mapping (not a generic FK regex): only the student-scoped
      // pointer FK means "bad sourceInteractionId" — other failures surface distinctly.
      const e = err as { constraint?: string; message?: string };
      if (e?.constraint === "memories_interaction_same_student" || /memories_interaction_same_student/.test(String(e?.message))) {
        throw new WorkspaceServiceError("INVALID_INPUT", "sourceInteractionId does not exist for this student");
      }
      mapDbBackstop(err);
    }
    if (result.rows.length === 0) throw new WorkspaceServiceError("STUDENT_NOT_FOUND");
    return toMemory(result.rows[0] as MemoryRow);
  }

  // --- reads (the HTTP surface) ---

  async getWorkspaceSummary(studentId: string): Promise<WorkspaceSummaryResponse> {
    requireUuid(studentId, "studentId");
    const result = await this.db.query(
      `SELECT s.id, s.tenant_id,
              (SELECT COUNT(*)::int FROM works w WHERE w.student_id = s.id) AS work_count,
              (SELECT COUNT(*)::int FROM interactions i WHERE i.student_id = s.id) AS interaction_count,
              (SELECT COUNT(*)::int FROM memories m WHERE m.student_id = s.id) AS memory_count,
              GREATEST((SELECT MAX(w.created_at) FROM works w WHERE w.student_id = s.id),
                       (SELECT MAX(i.created_at) FROM interactions i WHERE i.student_id = s.id),
                       (SELECT MAX(m.created_at) FROM memories m WHERE m.student_id = s.id)) AS last_activity_at
       FROM students s WHERE s.id = $1`,
      [studentId],
    );
    if (result.rows.length === 0) throw new WorkspaceServiceError("STUDENT_NOT_FOUND");
    const r = result.rows[0] as {
      id: string; tenant_id: string; work_count: number; interaction_count: number;
      memory_count: number; last_activity_at: unknown | null;
    };
    return {
      studentId: r.id,
      tenantId: r.tenant_id,
      workCount: r.work_count,
      interactionCount: r.interaction_count,
      memoryCount: r.memory_count,
      ...(r.last_activity_at !== null && { lastActivityAt: iso(r.last_activity_at) }),
    };
  }

  async getWork(workId: string): Promise<Work> {
    requireUuid(workId, "workId");
    const result = await this.db.query(`SELECT ${WORK_COLUMNS} FROM works WHERE id = $1`, [workId]);
    if (result.rows.length === 0) throw new WorkspaceServiceError("WORK_NOT_FOUND");
    return toWork(result.rows[0] as WorkRow);
  }

  async listWorks(studentId: string, query: WorkspaceListQuery = {}): Promise<ListWorksResponse> {
    const { rows, nextCursor } = await this.listRecency<WorkRow>("works", WORK_COLUMNS, studentId, query);
    return { studentId, works: rows.map(toWork), ...(nextCursor && { nextCursor }) };
  }

  async listInteractions(studentId: string, query: WorkspaceListQuery = {}): Promise<ListInteractionsResponse> {
    const { rows, nextCursor } = await this.listRecency<InteractionRow>("interactions", INTERACTION_COLUMNS, studentId, query);
    return { studentId, interactions: rows.map(toInteraction), ...(nextCursor && { nextCursor }) };
  }

  /** Importance-first (importance DESC, created_at DESC, id DESC keyset). */
  /**
   * COLD-path retrieval (agent-context.md, consumed by the Agent-I ContextBuilder):
   * semantic = latest-per-key (DF-v2-15 — duplicate rows are contract-accepted in storage,
   * the READER dedups), then importance-ranked top K; episodes = the reserved kind,
   * importance+recency top K. Separate from the paginated operator reads on purpose —
   * this is the model-context projection, not a browse surface.
   */
  async retrieveContextMemories(
    studentId: string,
    opts: { semanticTopK: number; episodeTopK: number },
  ): Promise<{ semantic: StudentMemory[]; episodes: StudentMemory[] }> {
    requireUuid(studentId, "studentId");
    const semantic = await this.db.query(
      `SELECT * FROM (
         SELECT DISTINCT ON (key) ${MEMORY_COLUMNS} FROM memories
         WHERE student_id = $1 AND key <> $3
         ORDER BY key, created_at DESC, id DESC
       ) latest
       ORDER BY importance DESC, created_at DESC, id DESC LIMIT $2`,
      [studentId, opts.semanticTopK, EPISODE_MEMORY_KEY],
    );
    const episodes = await this.db.query(
      `SELECT ${MEMORY_COLUMNS} FROM memories
       WHERE student_id = $1 AND key = $3
       ORDER BY importance DESC, created_at DESC, id DESC LIMIT $2`,
      [studentId, opts.episodeTopK, EPISODE_MEMORY_KEY],
    );
    return {
      semantic: (semantic.rows as MemoryRow[]).map(toMemory),
      episodes: (episodes.rows as MemoryRow[]).map(toMemory),
    };
  }

  /** Retrieval write-back (fields pre-built in Phase 2) — callers fire-and-forget. */
  async markMemoriesAccessed(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    for (const id of ids) requireUuid(id, "memory id");
    await this.db.query(
      `UPDATE memories SET last_accessed_at = NOW(), access_count = access_count + 1
       WHERE id = ANY($1::uuid[])`,
      [ids],
    );
  }

  async listMemories(studentId: string, query: WorkspaceListQuery = {}): Promise<ListMemoriesResponse> {
    requireUuid(studentId, "studentId");
    await this.requireStudent(studentId);
    const limit = clampLimit(query);
    let where = "m.student_id = $1";
    const params: unknown[] = [studentId, limit + 1];
    if (query.cursor !== undefined) {
      const [imp, createdAt, id] = decodeCursor(query.cursor, 3);
      const impNum = Number(imp);
      if (!Number.isFinite(impNum)) throw new WorkspaceServiceError("INVALID_INPUT", "invalid cursor");
      params.push(impNum, createdAt, id);
      where += " AND (m.importance, m.created_at, m.id) < ($3, $4, $5)";
    }
    const result = await this.db.query(
      `SELECT ${MEMORY_COLUMNS}, ${CURSOR_TS("m")} FROM memories m WHERE ${where}
       ORDER BY m.importance DESC, m.created_at DESC, m.id DESC LIMIT $2`,
      params,
    );
    const rows = result.rows as (MemoryRow & { created_at_cursor: string })[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      studentId,
      memories: page.map(toMemory),
      ...(rows.length > limit && last
        ? { nextCursor: encodeCursor([String(last.importance), last.created_at_cursor, last.id]) }
        : {}),
    };
  }

  /** Shared recency keyset (created_at DESC, id DESC) for works/interactions. */
  private async listRecency<R extends { created_at: unknown; id: string }>(
    table: "works" | "interactions",
    columns: string,
    studentId: string,
    query: WorkspaceListQuery,
  ): Promise<{ rows: R[]; nextCursor?: string }> {
    requireUuid(studentId, "studentId");
    await this.requireStudent(studentId);
    const limit = clampLimit(query);
    let where = "t.student_id = $1";
    const params: unknown[] = [studentId, limit + 1];
    if (query.cursor !== undefined) {
      const [createdAt, id] = decodeCursor(query.cursor, 2);
      params.push(createdAt, id);
      where += " AND (t.created_at, t.id) < ($3, $4)";
    }
    const result = await this.db.query(
      `SELECT ${columns}, ${CURSOR_TS("t")} FROM ${table} t WHERE ${where}
       ORDER BY t.created_at DESC, t.id DESC LIMIT $2`,
      params,
    );
    const rows = result.rows as (R & { created_at_cursor: string })[];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      rows: page,
      ...(rows.length > limit && last ? { nextCursor: encodeCursor([last.created_at_cursor, last.id]) } : {}),
    };
  }

  private async requireStudent(studentId: string): Promise<void> {
    const found = await this.db.query("SELECT 1 FROM students WHERE id = $1", [studentId]);
    if (found.rows.length === 0) throw new WorkspaceServiceError("STUDENT_NOT_FOUND");
  }
}
