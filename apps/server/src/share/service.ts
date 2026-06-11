/**
 * Share Service (Phase 3) — typed realization of docs/contracts/parent-share.md.
 *
 * Capability model: mint returns the RAW token exactly once; only its sha256 hash is
 * stored. Lookup is uniform-404 (unknown = expired = revoked — no validity oracle).
 *
 * PRIVACY: getShareView projects the workspace through the contract's DENY list — no
 * interactions, no operator metadata (aiParams/degraded/sessionId/stageId), no internal
 * ids (studentId/tenantId/workId), no raw memory rows. A serialization test pins it.
 */
import { createHash, randomBytes } from "node:crypto";
import type { MintShareRequest, MintShareResult, ParentShareView, ShareErrorCode, ShareErrorResponse, SharedWork } from "@genius-x/contracts";
import type { IdentityDb } from "../identity/service";

export const SHARE_ERROR_STATUS: Record<ShareErrorCode, number> = {
  SHARE_NOT_FOUND: 404,
  INVALID_INPUT: 400,
};

export class ShareServiceError extends Error {
  constructor(
    readonly code: ShareErrorCode,
    /** Operator-facing detail. NEVER contains a raw token. */
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ShareServiceError";
  }
  get httpStatus(): number {
    return SHARE_ERROR_STATUS[this.code];
  }
  toResponse(): ShareErrorResponse {
    return { error: this.code, ...(this.detail ? { detail: this.detail } : {}) };
  }
}

/**
 * Operator notification seam (shadow-grade: failure NEVER blocks mint/lesson). Default
 * implementation logs the capability URL for the operator to send manually; the WeChat
 * template-message sink replaces it when 资质 lands.
 *
 * The sink is an OPERATOR surface — internal ids are allowed here (exactly like traces):
 * `studentId` disambiguates links when a whole class's notifications interleave, so an
 * empty displayName can never cause a cross-family mis-forward.
 */
export interface NotificationSink {
  /**
   * Fire-and-forget. May be sync OR async (the WeChat sender will be async) — the caller
   * swallows sync throws AND rejections; an implementation never reaches the lesson path.
   * `hasArtifacts:false` flags a hollow link (zero works at mint time, e.g. force-advance
   * past both artifact stages) so the operator knows before forwarding it.
   */
  lessonShareReady(info: {
    studentId: string;
    studentDisplayName: string;
    lessonId: string;
    url: string;
    hasArtifacts: boolean;
  }): void | Promise<void>;
}

/** The URL arrives fully composed from LessonShareMinter — sinks never compose URLs. */
export const consoleNotificationSink: NotificationSink = {
  lessonShareReady: ({ studentId, studentDisplayName, lessonId, url, hasArtifacts }) => {
    // Operator-visible by design; the URL is the deliverable the operator forwards.
    const name = studentDisplayName === "" ? "（未命名）" : studentDisplayName;
    const hollow = hasArtifacts ? "" : " ⚠️ 暂无作品 — 链接现在打开是空页，建议稍后再发";
    console.log(`[share] 家长链接已生成 (${name} [${studentId}] · ${lessonId})${hollow}: ${url}`);
  },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Raw capability token: 32 bytes → base64url, always 43 chars, no padding. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SHARE_TTL_DAYS = 90;
/** Curation scans this many works per (student, lesson) — far above a lesson's realistic
 *  iteration volume; the projection collapses to latest-per-type + ≤4 slices per type. */
const SHARE_WORKS_SCAN_LIMIT = 200;

/** Up to 4 evenly-sampled drafts oldest→newest, ALWAYS including first and last. */
export function sampleSlices<T>(list: T[]): T[] {
  if (list.length <= 4) return [...list];
  const idx = [0, Math.round((list.length - 1) / 3), Math.round(((list.length - 1) * 2) / 3), list.length - 1];
  return [...new Set(idx)].map((i) => list[i]!);
}

const sha256hex = (s: string): string => createHash("sha256").update(s).digest("hex");
const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/**
 * Defense-in-depth on `contentJson` (parent-share.md DENY list): the column is an
 * unfiltered pass-through by shape, so the served copy is deep-scrubbed of denied keys.
 * Today's only writer (buildWorkContent) emits none of these — a drop firing means a NEW
 * writer broke the "contentJson is parent-visible" rule, so it is operator-logged
 * (never a silent filter; degradation principle).
 */
const DENIED_CONTENT_KEYS = new Set(["aiParams", "degraded", "sessionId", "stageId", "studentId", "tenantId", "parentId"]);

function scrubDeniedKeys(value: unknown, dropped: string[]): unknown {
  if (Array.isArray(value)) return value.map((v) => scrubDeniedKeys(v, dropped));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DENIED_CONTENT_KEYS.has(k)) {
        dropped.push(k);
        continue;
      }
      out[k] = scrubDeniedKeys(v, dropped);
    }
    return out;
  }
  return value;
}

export class ShareService {
  constructor(private readonly db: IdentityDb) {}

  /**
   * SERVER-INTERNAL (lesson end / admin tool). Returns the raw token EXACTLY ONCE.
   * Re-minting issues a new token; prior tokens serve until their own expiry.
   */
  async mintShareToken(req: MintShareRequest): Promise<MintShareResult> {
    if (!UUID_RE.test(req.studentId)) throw new ShareServiceError("INVALID_INPUT", "studentId is not a UUID");
    const lessonId = req.lessonId.trim();
    if (lessonId === "" || lessonId.length > 200) {
      throw new ShareServiceError("INVALID_INPUT", "lessonId must be non-empty (<=200 chars)");
    }
    const token = randomBytes(32).toString("base64url");
    const result = await this.db.query(
      `INSERT INTO share_tokens (token_hash, student_id, tenant_id, lesson_id, expires_at)
       SELECT $2, s.id, s.tenant_id, $3, NOW() + ($4 || ' days')::interval
       FROM students s WHERE s.id = $1
       RETURNING expires_at`,
      [req.studentId, sha256hex(token), lessonId, String(SHARE_TTL_DAYS)],
    );
    if (result.rows.length === 0) throw new ShareServiceError("INVALID_INPUT", "student does not exist");
    return { token, expiresAt: iso((result.rows[0] as { expires_at: unknown }).expires_at) };
  }

  /**
   * The PUBLIC read. Uniform 404 on anything not currently servable; 400 only for a
   * token that is not even shaped like one (no oracle either way).
   */
  async getShareView(token: string): Promise<ParentShareView> {
    if (!TOKEN_RE.test(token)) throw new ShareServiceError("INVALID_INPUT", "malformed token");
    const found = await this.db.query(
      `SELECT st.student_id, st.lesson_id, st.created_at, st.expires_at, s.display_name
       FROM share_tokens st JOIN students s ON s.id = st.student_id
       WHERE st.token_hash = $1 AND st.expires_at > NOW()`,
      [sha256hex(token)],
    );
    if (found.rows.length === 0) throw new ShareServiceError("SHARE_NOT_FOUND");
    const row = found.rows[0] as {
      student_id: string;
      lesson_id: string;
      created_at: unknown;
      expires_at: unknown;
      display_name: string;
    };

    const dropped: string[] = [];

    // The hero certificate is queried INDEPENDENTLY of the works window — the contract's
    // derivation ("newest birth_certificate work's contentJson") has no recency window, so
    // it must not vanish when 20+ newer works accumulate across re-run sessions.
    const certRows = await this.db.query(
      `SELECT content_json FROM works
       WHERE student_id = $1 AND lesson_id = $2 AND type = 'birth_certificate'
       ORDER BY seq DESC LIMIT 1`,
      [row.student_id, row.lesson_id],
    );
    const rawCert = (certRows.rows[0] as { content_json: Record<string, unknown> | null } | undefined)?.content_json;
    const certificate = rawCert != null ? (scrubDeniedKeys(rawCert, dropped) as Record<string, unknown>) : undefined;

    // ALL of this lesson's works oldest→newest (certificate excluded — it is the hero),
    // bounded; CURATION happens here (parent-share.md v1.3, decision ②): the gallery is
    // the LATEST Work per type (每课精选 finals), iterating types expose up to 4
    // evenly-sampled drafts (打磨轨迹). Everything passes the same DENY-list scrub.
    // DESC scan so the NEWEST works survive the bound (an ASC LIMIT would truncate the
    // finals on a 200+ row lesson), reversed in memory to oldest→newest for sampling;
    // seq = the monotonic insertion order (review blocker: created_at ties on PGlite ms
    // resolution made "latest per type" a coin flip — a draft served as the final).
    const works = await this.db.query(
      `SELECT type, content_url, content_text, content_json, thumbnail_url, created_at
       FROM works WHERE student_id = $1 AND lesson_id = $2 AND type <> 'birth_certificate'
       ORDER BY seq DESC LIMIT $3`,
      [row.student_id, row.lesson_id, SHARE_WORKS_SCAN_LIMIT],
    );
    if (works.rows.length === SHARE_WORKS_SCAN_LIMIT) {
      // Operator-greppable (the [share-scrub] pattern): older drafts fell outside the
      // window — finals stay correct (DESC), iteration totals under-count.
      console.warn("[share-curation] works scan hit the bound:", { limit: SHARE_WORKS_SCAN_LIMIT, lessonId: row.lesson_id });
    }
    works.rows.reverse();
    const all: SharedWork[] = (works.rows as {
      type: string;
      content_url: string | null;
      content_text: string | null;
      content_json: Record<string, unknown> | null;
      thumbnail_url: string | null;
      created_at: unknown;
    }[]).map((w) => ({
      type: w.type,
      ...(w.content_url !== null && { contentUrl: w.content_url }),
      ...(w.content_text !== null && { contentText: w.content_text }),
      ...(w.content_json !== null && { contentJson: scrubDeniedKeys(w.content_json, dropped) as Record<string, unknown> }),
      ...(w.thumbnail_url !== null && { thumbnailUrl: w.thumbnail_url }),
      createdAt: iso(w.created_at),
    }));
    const byType = new Map<string, SharedWork[]>();
    for (const w of all) {
      const list = byType.get(w.type) ?? [];
      list.push(w);
      byType.set(w.type, list);
    }
    const shared: SharedWork[] = [...byType.values()].map((list) => list[list.length - 1]!); // latest per type
    const iterations = [...byType.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([type, list]) => ({ type, total: list.length, slices: sampleSlices(list) }));

    if (dropped.length > 0) {
      // Operator-visible (greppable, like [client-degraded]) — a writer upstream put
      // operator metadata into a parent-visible contentJson. Never the values, keys only.
      console.warn("[share-scrub] dropped DENIED keys from served contentJson:", { keys: dropped, lessonId: row.lesson_id });
    }

    return {
      studentDisplayName: row.display_name,
      lessonId: row.lesson_id,
      ...(certificate !== undefined && { certificate }),
      works: shared,
      ...(iterations.length > 0 && { iterations }),
      sharedAt: iso(row.created_at),
      expiresAt: iso(row.expires_at),
    };
  }

  /**
   * Retention sweep (parent-share.md owner matrix: "purge after expiry+30d"). Runs at boot
   * (index.ts) — a scheduled job replaces it when one exists. Returns the purged count so
   * the caller can log it (operator-visible, never a silent deletion).
   */
  async purgeExpired(): Promise<number> {
    const res = await this.db.query(
      `DELETE FROM share_tokens WHERE expires_at < NOW() - INTERVAL '30 days' RETURNING 1`,
    );
    return res.rows.length;
  }
}

/**
 * Lesson-end mint+notify composition (the controller's one-call surface). Sink failures
 * are swallowed here (shadow-grade); MINT failures propagate so the caller can trace.
 */
export class LessonShareMinter {
  constructor(
    private readonly share: ShareService,
    private readonly notify: NotificationSink,
    private readonly webBaseUrl: string,
  ) {}

  async mintAndNotify(req: {
    studentId: string;
    studentDisplayName: string;
    lessonId: string;
    /** False ⇒ hollow link (no works at mint time) — flagged to the sink AND the caller's trace. */
    hasArtifacts: boolean;
  }): Promise<void> {
    const { token } = await this.share.mintShareToken({ studentId: req.studentId, lessonId: req.lessonId });
    const url = `${this.webBaseUrl}/?share=${token}`;
    // The sink is a shadow system: its failure never propagates (link retrievable via
    // tools/parent-link.mjs); the mint itself already succeeded. Promise.resolve().then()
    // swallows BOTH sync throws and async rejections — an async sink (the WeChat sender)
    // must never escape as an unhandledRejection and kill the server mid-class.
    await Promise.resolve()
      .then(() => this.notify.lessonShareReady({ ...req, url }))
      .catch(() => {});
  }
}
