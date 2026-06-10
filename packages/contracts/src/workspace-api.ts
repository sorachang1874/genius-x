/**
 * Workspace READ API types — contracts v1 (Phase 2).
 *
 * Typed realization of `docs/contracts/workspace.md` → API surface. Phase 2 exposes READS
 * over HTTP (operator/admin now; the Phase-3 parent artifact builds on them with privacy
 * filtering); WRITES are server-internal (`Record*Request` in workspace.ts, called
 * in-process by the Classroom Service) — the same privilege-boundary pattern as
 * `StudentProgressUpdate`. Parent/child clients NEVER write the workspace in Phase 2.
 *
 * Endpoint map (implemented in `apps/server/src/workspace/`):
 *   GET /students/:id/workspace               →                      → WorkspaceSummaryResponse
 *   GET /students/:id/works?limit&cursor      → WorkspaceListQuery   → ListWorksResponse
 *   GET /works/:id                            →                      → Work
 *   GET /students/:id/interactions?limit&cursor                      → ListInteractionsResponse
 *   GET /students/:id/memories?limit&cursor                          → ListMemoriesResponse
 *
 * Ordering: works/interactions are RECENCY-first (created_at DESC, id DESC keyset — the
 * Phase-3 parent artifact reads "recent works"); memories are importance-first
 * (importance DESC, created_at DESC, id DESC — the id tiebreak is REQUIRED for a total
 * order: same-transaction inserts share created_at and Phase-2 importance is uniform).
 * Cursors are opaque. All /students/:id/* reads validate the student first: unknown
 * student ⇒ 404 STUDENT_NOT_FOUND, never an empty page.
 */
import type { InteractionRecord, StudentMemory, Work } from "./workspace";

// --- GET /students/:id/workspace (cheap counts summary, not a full dump) ---

export interface WorkspaceSummaryResponse {
  studentId: string;
  tenantId: string;
  workCount: number;
  interactionCount: number;
  memoryCount: number;
  /** Most recent workspace activity (ISO), absent when the workspace is empty. */
  lastActivityAt?: string;
}

// --- Shared list query (mirrors the identity admin list) ---

/** Cursor pagination. `limit` clamps server-side (default 20, max 100). */
export interface WorkspaceListQuery {
  limit?: number;
  cursor?: string; // opaque cursor from a prior `nextCursor`; absent ⇒ first page
}

export interface ListWorksResponse {
  studentId: string;
  works: Work[];
  nextCursor?: string;
}

export interface ListInteractionsResponse {
  studentId: string;
  interactions: InteractionRecord[];
  nextCursor?: string;
}

export interface ListMemoriesResponse {
  studentId: string;
  memories: StudentMemory[];
  nextCursor?: string;
}

// --- Error registry (workspace read API) ---

/**
 * HTTP status mapping (enforced at the service boundary; exhaustive map preflight as in
 * enrollment.md):
 *   STUDENT_NOT_FOUND → 404
 *   WORK_NOT_FOUND    → 404
 *   INVALID_INPUT     → 400  (malformed id/cursor/limit, schema failure)
 * Undefined failures follow the enrollment.md v1.1 rule: sanitized `500 INTERNAL`,
 * deliberately off-registry.
 */
export type WorkspaceErrorCode = "STUDENT_NOT_FOUND" | "WORK_NOT_FOUND" | "INVALID_INPUT";

export interface WorkspaceErrorResponse {
  error: WorkspaceErrorCode;
  /** Operator-facing detail only — never rendered to a child, never raw PII. */
  detail?: string;
}
