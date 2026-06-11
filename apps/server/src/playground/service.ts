/**
 * PlaygroundService — agent-session.md v1 (the unlock door + the v0 world view) and
 * world.md v1 (the zero-AI floor's data). Phase 6.5 Step 3.
 *
 * GATE ⑤ (agent-session.md rule 3): v0 is READ-ONLY — this service never writes child
 * playground data. The ONLY write is the PARENT-initiated unlock mint
 * (playground_session_tokens — parent-surface.md v1.2's second parent write).
 *
 * TOKEN CLASS: separate from parent_access_tokens by contract (one student, playground
 * scope, TTL = age-band quota + 5-min grace; minting revokes the prior unexpired token —
 * the token IS the session lock). Uniform 404 everywhere.
 */
import { createHash, randomBytes } from "node:crypto";
import type { PlaygroundSessionResult, PlaygroundWorldView, SharedWork, TraceEvent, TraceSink, WorldAlbumPage, WorldWallItem } from "@genius-x/contracts";
import type { IdentityDb } from "../identity/service";
import { ShareServiceError, sampleSlices, scrubDeniedKeys } from "../share/service";

/** Structural mint-denial discriminant (never matched by detail-substring — review fix). */
export class PlaygroundDeniedError extends Error {
  constructor(readonly kind: "curfew" | "daily_quota") {
    super(`playground mint denied: ${kind}`);
    this.name = "PlaygroundDeniedError";
  }
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRACE_MINUTES = 5;
const WALL_SCAN_LIMIT = 500;
const sha256hex = (s: string): string => createHash("sha256").update(s).digest("hex");
const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/** Q1 posture (agent-session.md rule 1): age-band session quota in minutes. */
export function sessionQuotaMinutes(age: number): number {
  return age <= 6 ? 15 : 20;
}

/** Curfew (21:00–06:00 Asia/Shanghai — the friend sleeps). Config override is the
 *  playground_settings work (deferred with the parent panel); defaults here. */
export function inCurfew(now: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Shanghai" }).format(now));
  return hour >= 21 || hour < 6;
}

export class PlaygroundService {
  constructor(
    private readonly db: IdentityDb,
    private readonly trace: TraceSink = { record: (e) => console.log("[trace]", e.kind, e.payload) },
    private readonly now: () => Date = () => new Date(),
  ) {}

  private mk(reason: string, payload: Record<string, unknown>): void {
    const e: TraceEvent = { at: this.now().toISOString(), kind: "interaction", payload: { ...payload, reason } };
    try {
      this.trace.record(e);
    } catch {
      // trace is shadow
    }
  }

  /**
   * The PARENT-door mint (parent-surface.md v1.2). Caller (the parent route) has
   * already verified the child belongs to this parent — this method re-verifies scope
   * defensively, applies the curfew, revokes the prior token, and mints.
   */
  async mintSession(parentId: string, studentId: string): Promise<PlaygroundSessionResult> {
    if (!UUID_RE.test(parentId) || !UUID_RE.test(studentId)) throw new ShareServiceError("SHARE_NOT_FOUND");
    const student = await this.db.query(
      `SELECT age FROM students WHERE id = $1 AND parent_id = $2`,
      [studentId, parentId],
    );
    if (student.rows.length === 0) throw new ShareServiceError("SHARE_NOT_FOUND"); // uniform — no oracle
    if (inCurfew(this.now())) {
      // The friend is asleep — gentle parent-facing copy at the route; countable here.
      this.mk("playground_mint_curfew_rejected", { studentId });
      throw new PlaygroundDeniedError("curfew");
    }
    const age = (student.rows[0] as { age: number }).age;
    const dailyQuota = sessionQuotaMinutes(age);
    // DAILY accounting at the mint (agent-session.md v1.1 interim, gate-⑤-compatible:
    // reads the parent-write table only): revoked tokens count ELAPSED time, live/expired
    // ones their full window minus grace — re-handoffs are not double-billed.
    // per token: min(elapsed-until-{revoke|now|expiry}, its quota portion = TTL - grace)
    // — revoked count elapsed only, expired count full quota, live count elapsed-so-far.
    const used = await this.db.query(
      `SELECT COALESCE(SUM(GREATEST(0, LEAST(
         EXTRACT(EPOCH FROM (LEAST(COALESCE(revoked_at, NOW()), NOW(), expires_at) - created_at)) / 60,
         EXTRACT(EPOCH FROM (expires_at - created_at)) / 60 - $2::numeric
       ))), 0) AS minutes
       FROM playground_session_tokens
       WHERE student_id = $1
         AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'`,
      [studentId, String(GRACE_MINUTES)],
    );
    const usedMinutes = Number((used.rows[0] as { minutes: unknown }).minutes);
    const remaining = dailyQuota - usedMinutes;
    if (remaining < 3) {
      this.mk("playground_mint_quota_exhausted", { studentId, usedMinutes: Math.round(usedMinutes) });
      throw new PlaygroundDeniedError("daily_quota");
    }
    const ttlMinutes = Math.min(remaining, dailyQuota) + GRACE_MINUTES;
    const token = randomBytes(32).toString("base64url");
    // One active session per student, DB-ENFORCED (UNIQUE partial index): revoke ALL
    // unrevoked rows (expired ones too — harmless), then insert; a concurrent-mint loser
    // hits the unique violation and retries once (a NAMED divergence from share-token
    // re-mint semantics — agent-session.md).
    let expiresAt: unknown;
    for (let attempt = 0; ; attempt++) {
      const revoked = await this.db.query(
        `UPDATE playground_session_tokens SET revoked_at = NOW()
         WHERE student_id = $1 AND revoked_at IS NULL RETURNING expires_at > NOW() AS live`,
        [studentId],
      );
      const liveRevoked = (revoked.rows as { live: boolean }[]).filter((x) => x.live).length;
      if (liveRevoked > 0) this.mk("playground_token_revoked_by_remint", { studentId, count: liveRevoked });
      try {
        const r = await this.db.query(
          `INSERT INTO playground_session_tokens (token_hash, student_id, tenant_id, expires_at)
           SELECT $2, s.id, s.tenant_id, NOW() + ($3 || ' minutes')::interval
           FROM students s WHERE s.id = $1
           RETURNING expires_at`,
          [studentId, sha256hex(token), String(Math.round(ttlMinutes))],
        );
        expiresAt = (r.rows[0] as { expires_at: unknown }).expires_at;
        break;
      } catch (err) {
        if (attempt === 0 && String((err as Error).message ?? err).includes("idx_playground_tokens_active")) continue;
        throw err; // not the concurrent-mint race — surface it
      }
    }
    this.mk("playground_session_opened", { studentId, ttlMinutes: Math.round(ttlMinutes) });
    return { token, expiresAt: iso(expiresAt) };
  }

  /** Uniform 404 resolver (unknown = expired = revoked = malformed-but-shaped). */
  async resolveSession(token: string): Promise<{ studentId: string; expiresAt: string } | null> {
    if (!TOKEN_RE.test(token)) return null;
    const r = await this.db.query(
      `SELECT student_id, expires_at FROM playground_session_tokens
       WHERE token_hash = $1 AND expires_at > NOW() AND revoked_at IS NULL`,
      [sha256hex(token)],
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0] as { student_id: string; expires_at: unknown };
    return { studentId: row.student_id, expiresAt: iso(row.expires_at) };
  }

  /** Retention sweep (the share pattern): expiry+24h — session tokens are minutes-lived. */
  async purgeExpired(): Promise<number> {
    const r = await this.db.query(
      `DELETE FROM playground_session_tokens WHERE expires_at < NOW() - INTERVAL '24 hours' RETURNING 1`,
    );
    return r.rows.length;
  }

  /**
   * The v0 world in ONE read (world.md): 作品上墙 (curated latest-per-type across ALL
   * lessons + replay slices — the share-curation pattern, seq-ordered) + 相册 (version
   * snapshots, surface only) + the companion surface. DENY discipline extends.
   */
  async worldView(studentId: string, sessionExpiresAt: string): Promise<PlaygroundWorldView> {
    const student = await this.db.query(
      `SELECT s.display_name, c.surface AS companion_surface
       FROM students s LEFT JOIN ip_characters c ON c.student_id = s.id
       WHERE s.id = $1`,
      [studentId],
    );
    if (student.rows.length === 0) throw new ShareServiceError("SHARE_NOT_FOUND");
    const srow = student.rows[0] as {
      display_name: string;
      companion_surface: { name?: string; personality?: string } | null;
    };

    const dropped: string[] = [];
    const works = await this.db.query(
      `SELECT type, content_url, content_text, content_json, thumbnail_url, created_at
       FROM works WHERE student_id = $1 AND type <> 'birth_certificate'
       ORDER BY seq DESC LIMIT $2`,
      [studentId, WALL_SCAN_LIMIT],
    );
    if (works.rows.length === WALL_SCAN_LIMIT) {
      console.warn("[playground-curation] works scan hit the bound:", { limit: WALL_SCAN_LIMIT, studentId });
    }
    works.rows.reverse(); // oldest→newest for sampling
    const all: SharedWork[] = (works.rows as {
      type: string; content_url: string | null; content_text: string | null;
      content_json: Record<string, unknown> | null; thumbnail_url: string | null; created_at: unknown;
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
    const wall: WorldWallItem[] = [...byType.entries()].map(([type, list]) => ({
      type,
      final: list[list.length - 1]!,
      // drafts BEFORE the final (the final is the wall itself — review fix: no stutter
      // where the last replay step duplicates the hung final)
      slices: list.length > 1 ? sampleSlices(list.slice(0, -1)) : [],
    }));
    if (dropped.length > 0) {
      console.warn("[playground-scrub] dropped DENIED keys:", { keys: dropped });
    }

    const versions = await this.db.query(
      `SELECT version, surface, created_at FROM ip_character_versions
       WHERE student_id = $1 ORDER BY version ASC`,
      [studentId],
    );
    const album: WorldAlbumPage[] = (versions.rows as {
      version: number;
      surface: { name?: string; personality?: string; backstory?: string };
      created_at: unknown;
    }[]).map((v) => ({
      version: v.version,
      surface: {
        ...(v.surface.name && { name: v.surface.name }),
        ...(v.surface.personality && { personality: v.surface.personality }),
        ...(v.surface.backstory && { backstory: v.surface.backstory }),
      },
      createdAt: iso(v.created_at),
    }));

    return {
      serverNow: this.now().toISOString(),
      displayName: srow.display_name,
      ...(srow.companion_surface !== null && {
        companion: {
          ...(srow.companion_surface.name && { name: srow.companion_surface.name }),
          ...(srow.companion_surface.personality && { personality: srow.companion_surface.personality }),
        },
      }),
      wall,
      album,
      sessionExpiresAt,
    };
  }
}
