/**
 * ParentSurfaceService — docs/contracts/parent-surface.md (Phase 6, Agent K server side).
 *
 * AUTH: the proven capability machinery, PARENT-scoped (raw token once, sha256-hash-only
 * storage, uniform 404). SMS/WeChat login replaces the operator MINT later behind this
 * same verifier seam (shadow rule) — the reads never change.
 *
 * PRIVACY: every read joins through `students.parent_id` (scope = this parent's children
 * ONLY, cross-family = uniform 404, never an existence oracle). The parent-share DENY
 * discipline extends: no transcripts, no episodes (pending decision), no operator
 * metadata, no base_canon internals — timelines serve the SURFACE projection only.
 *
 * CO-WORKING v1: the parent note — safety-reviewed BEFORE storage (parent input is still
 * input), ≤3 pending per child, relayed by the companion exactly once (context builder).
 */
import { createHash, randomBytes } from "node:crypto";
import type {
  AddParentNoteRequest,
  GrowthTimelineEntry,
  ParentAccessResult,
  ParentChildSummary,
  ParentTimelineResponse,
  SharedWork,
  TraceEvent,
  TraceSink,
} from "@genius-x/contracts";
import type { SafetyFilter } from "@genius-x/ai-gateway";
import type { IdentityDb } from "../identity/service";
import { ShareServiceError, scrubDeniedKeys } from "../share/service";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCESS_TTL_DAYS = 180;
const MAX_PENDING_NOTES = 3;
const sha256hex = (s: string): string => createHash("sha256").update(s).digest("hex");
const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/** The relay seam the ContextBuilder consumes (unrelayed → inject once → mark). */
export interface ParentNoteRelay {
  unrelayedNotes(studentId: string, limit: number): Promise<{ id: string; note: string }[]>;
  markRelayed(ids: string[]): Promise<void>;
}

export class ParentSurfaceService implements ParentNoteRelay {
  constructor(
    private readonly db: IdentityDb,
    private readonly safety: SafetyFilter,
    /** Operator visibility (contract Visibility row): parent_note_stored / _rejected.
     *  Console default = visible-by-default (the server.ts consoleTrace posture). */
    private readonly trace: TraceSink = { record: (e) => console.log("[trace]", e.kind, e.payload) },
  ) {}

  /** Counts/ids/causes only — NEVER note text (trace-redaction posture). Reason rides
   *  last so a payload key can never clobber it (the Phase-4 review fix). */
  private mk(reason: string, payload: Record<string, unknown>): void {
    const e: TraceEvent = { at: new Date().toISOString(), kind: "interaction", payload: { ...payload, reason } };
    try {
      this.trace.record(e);
    } catch {
      // trace is shadow — never throws into the parent surface
    }
  }

  /** OPERATOR mint (identity-admin posture). Raw token exactly once; 180-day expiry. */
  async mintAccess(parentId: string): Promise<ParentAccessResult> {
    if (!UUID_RE.test(parentId)) throw new ShareServiceError("INVALID_INPUT", "parentId is not a UUID");
    const token = randomBytes(32).toString("base64url");
    const r = await this.db.query(
      `INSERT INTO parent_access_tokens (token_hash, parent_id, tenant_id, expires_at)
       SELECT $2, p.id, p.tenant_id, NOW() + ($3 || ' days')::interval
       FROM parents p WHERE p.id = $1
       RETURNING expires_at`,
      [parentId, sha256hex(token), String(ACCESS_TTL_DAYS)],
    );
    if (r.rows.length === 0) throw new ShareServiceError("INVALID_INPUT", "parent does not exist");
    return { token, expiresAt: iso((r.rows[0] as { expires_at: unknown }).expires_at) };
  }

  /** Uniform 404 resolver: unknown = expired = malformed-but-shaped (no oracle). */
  async resolveParent(token: string): Promise<{ parentId: string; tenantId: string } | null> {
    if (!TOKEN_RE.test(token)) return null;
    const r = await this.db.query(
      `SELECT parent_id, tenant_id FROM parent_access_tokens
       WHERE token_hash = $1 AND expires_at > NOW()`,
      [sha256hex(token)],
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0] as { parent_id: string; tenant_id: string };
    return { parentId: row.parent_id, tenantId: row.tenant_id };
  }

  /** Retention sweep (the share-service pattern): expiry+30d. */
  async purgeExpired(): Promise<number> {
    const r = await this.db.query(
      `DELETE FROM parent_access_tokens WHERE expires_at < NOW() - INTERVAL '30 days' RETURNING 1`,
    );
    return r.rows.length;
  }

  async listChildren(parentId: string): Promise<ParentChildSummary[]> {
    const r = await this.db.query(
      `SELECT s.id, s.display_name, s.age, s.completed_lesson_ids,
              c.surface AS companion_surface
       FROM students s LEFT JOIN ip_characters c ON c.student_id = s.id
       WHERE s.parent_id = $1
       ORDER BY s.created_at ASC, s.id ASC`,
      [parentId],
    );
    return (r.rows as {
      id: string; display_name: string; age: number; completed_lesson_ids: string[];
      companion_surface: { name?: string; personality?: string; backstory?: string } | null;
    }[]).map((row) => ({
      studentId: row.id,
      displayName: row.display_name,
      age: row.age,
      completedLessonIds: row.completed_lesson_ids,
      ...(row.companion_surface !== null && {
        companion: {
          ...(row.companion_surface.name && { name: row.companion_surface.name }),
          ...(row.companion_surface.personality && { personality: row.companion_surface.personality }),
          ...(row.companion_surface.backstory && { backstory: row.companion_surface.backstory }),
        },
      }),
    }));
  }

  /** Scope gate: the child must belong to THIS parent — else uniform 404 (no oracle).
   *  PUBLIC: the works route gates on this directly (one indexed single-row query — the
   *  review fix replacing the full-timeline-as-gate coupling). */
  async scopedStudent(parentId: string, studentId: string): Promise<{ displayName: string } | null> {
    if (!UUID_RE.test(studentId)) return null;
    const r = await this.db.query(
      `SELECT display_name FROM students WHERE id = $1 AND parent_id = $2`,
      [studentId, parentId],
    );
    return r.rows.length === 0 ? null : { displayName: (r.rows[0] as { display_name: string }).display_name };
  }

  /** The growth timeline: version snapshots (SURFACE only) + lineage works per version. */
  async timeline(parentId: string, studentId: string): Promise<ParentTimelineResponse | null> {
    const student = await this.scopedStudent(parentId, studentId);
    if (!student) return null;
    const versions = await this.db.query(
      `SELECT version, surface, updated_by, created_at FROM ip_character_versions
       WHERE student_id = $1 ORDER BY version ASC`,
      [studentId],
    );
    const works = await this.db.query(
      `SELECT type, content_url, content_text, content_json, thumbnail_url, created_at, ip_character_version
       FROM works WHERE student_id = $1 AND ip_character_version IS NOT NULL
       ORDER BY seq ASC LIMIT 500`,
      [studentId],
    );
    const byVersion = new Map<number, SharedWork[]>();
    const dropped: string[] = [];
    for (const w of works.rows as {
      type: string; content_url: string | null; content_text: string | null;
      content_json: Record<string, unknown> | null;
      thumbnail_url: string | null; created_at: unknown; ip_character_version: number;
    }[]) {
      const list = byVersion.get(w.ip_character_version) ?? [];
      list.push({
        type: w.type,
        ...(w.content_url !== null && { contentUrl: w.content_url }),
        ...(w.content_text !== null && { contentText: w.content_text }),
        // SAME projection as the /works route (review fix): a contentJson-only work
        // (e.g. a lesson-2+ birth certificate with lineage) must not serve as an empty
        // card — DENY-scrubbed, identical to the share view's discipline.
        ...(w.content_json !== null && { contentJson: scrubDeniedKeys(w.content_json, dropped) as Record<string, unknown> }),
        ...(w.thumbnail_url !== null && { thumbnailUrl: w.thumbnail_url }),
        createdAt: iso(w.created_at),
      });
      byVersion.set(w.ip_character_version, list);
    }
    if (dropped.length > 0) console.warn("[parent-scrub] dropped DENIED keys:", { keys: dropped });
    const entries: GrowthTimelineEntry[] = (versions.rows as {
      version: number;
      surface: { name?: string; personality?: string; backstory?: string };
      updated_by: { lessonId?: string };
      created_at: unknown;
    }[]).map((v) => ({
      version: v.version,
      surface: {
        ...(v.surface.name && { name: v.surface.name }),
        ...(v.surface.personality && { personality: v.surface.personality }),
        ...(v.surface.backstory && { backstory: v.surface.backstory }),
      },
      lessonId: v.updated_by.lessonId ?? "",
      createdAt: iso(v.created_at),
      works: byVersion.get(v.version) ?? [],
    }));
    return { studentId, displayName: student.displayName, entries };
  }

  /** Co-working v1: reviewed-before-stored, bounded, ≤3 pending per child. */
  async addNote(parentId: string, studentId: string, req: AddParentNoteRequest): Promise<{ id: string }> {
    const student = await this.scopedStudent(parentId, studentId);
    if (!student) throw new ShareServiceError("SHARE_NOT_FOUND"); // uniform 404, no oracle
    const text = req.text?.trim() ?? "";
    if (text === "" || text.length > 200) {
      this.mk("parent_note_rejected", { cause: "length", studentId });
      throw new ShareServiceError("INVALID_INPUT", "note must be 1-200 chars");
    }
    const review = this.safety.reviewInput(text);
    if (!review.ok) {
      // never stored; the route maps this to gentle parent-facing copy. The trace
      // carries cause/ids only — NEVER content (the filter's reasons embed the matched
      // word, i.e. note text — they stay out of traces by the redaction posture).
      this.mk("parent_note_rejected", { cause: "safety_filtered", studentId });
      throw new ShareServiceError("INVALID_INPUT", "note rejected by content review");
    }
    // The pending cap rides INSIDE the insert (single statement — review fix: a
    // COUNT-then-INSERT pair raced under concurrent submissions). Scope was proven
    // above, so zero rows here means exactly the cap.
    const r = await this.db.query(
      `INSERT INTO parent_notes (parent_id, student_id, tenant_id, note)
       SELECT p.id, $2, p.tenant_id, $3 FROM parents p
       WHERE p.id = $1
         AND (SELECT COUNT(*) FROM parent_notes WHERE student_id = $2 AND relayed_at IS NULL) < $4
       RETURNING id`,
      [parentId, studentId, text, String(MAX_PENDING_NOTES)],
    );
    if (r.rows.length === 0) {
      this.mk("parent_note_rejected", { cause: "pending_cap", studentId });
      throw new ShareServiceError("INVALID_INPUT", "too many pending notes — the companion will relay them first");
    }
    const id = (r.rows[0] as { id: string }).id;
    this.mk("parent_note_stored", { noteId: id, studentId });
    return { id };
  }

  // --- ParentNoteRelay (the context builder's seam) ---

  async unrelayedNotes(studentId: string, limit: number): Promise<{ id: string; note: string }[]> {
    const r = await this.db.query(
      `SELECT id, note FROM parent_notes
       WHERE student_id = $1 AND relayed_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT $2`,
      [studentId, limit],
    );
    return r.rows as { id: string; note: string }[];
  }

  async markRelayed(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.query(
      `UPDATE parent_notes SET relayed_at = NOW() WHERE id = ANY($1::uuid[]) AND relayed_at IS NULL`,
      [ids],
    );
  }
}
