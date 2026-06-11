/**
 * IpCharacterService — the IP character entity (docs/contracts/ip-character.md v1,
 * Phase 4.5; Agent H storage). The product anchor: born at lesson-001 (version 1 = the
 * birth snapshot), continuously refined across lessons.
 *
 * LAYERED MODEL (founder decisions ③/④, principle P2):
 *   base_canon — locked (brand DNA + the essential 伙伴 form; only a lead-serialized
 *                brand migration touches it — NEVER this service's refine path)
 *   surface    — child-refined; every ACCEPTED refinement = an immutable version snapshot
 *   (temporary skins are works, never rows here)
 *
 * REFINEMENT IDEMPOTENCY (contract): a write equal to the current row is a NO-OP — no
 * version bump (`ip_refine_noop` is the CALLER's trace; this returns the signal). The
 * parent-facing growth timeline never grows from a retry.
 *
 * MIRROR STEP (the GeniusXProfile transition, pinned in the contract): after every write,
 * projected genius_x columns are REPLACED from the canonical surface (name→genius_x_name,
 * appearanceRef→the work's contentUrl→genius_x_avatar_url, personality→personality_tag,
 * backstory→background_setting). birthdaySpeech is a RITUAL field, not character state —
 * it keeps identity.md's COALESCE semantics via the existing lesson write-back. From 4.5
 * on, nothing else writes the projected columns.
 */
import type { IpCharacter, IpCharacterProvenance, IpCharacterSurface } from "@genius-x/contracts";
import { WorkspaceServiceError } from "./service";
import type { IdentityDb } from "../identity/service";

/** v0 base canon (ip-character.md owner matrix): fixed placeholder pending the brand doc. */
export const BASE_CANON_V0 = {
  brandStyleVersion: "style-v0",
  baseForm: "魔法泥人基础形象 v0",
} as const;

const SURFACE_CAPS = { name: 50, trait: 50, traits: 10, personality: 500, backstory: 500, appearanceRef: 512 };

export type RefineOutcome =
  | { kind: "created"; character: IpCharacter; partialBackfill: boolean }
  | { kind: "refined"; character: IpCharacter }
  | { kind: "noop"; character: IpCharacter };

export class IpCharacterService {
  constructor(private readonly db: IdentityDb) {}

  /** Newest avatar work id (by monotonic seq) — the lesson-end refine's appearanceRef. */
  async newestAvatarRef(studentId: string): Promise<string | undefined> {
    const r = await this.db.query(
      `SELECT id FROM works WHERE student_id = $1 AND type = 'avatar_image' ORDER BY seq DESC LIMIT 1`,
      [studentId],
    );
    return r.rows.length > 0 ? (r.rows[0] as { id: string }).id : undefined;
  }

  async getCharacter(studentId: string): Promise<IpCharacter | null> {
    const r = await this.db.query(
      `SELECT student_id, tenant_id, base_canon, surface, version, updated_by, created_at, updated_at
       FROM ip_characters WHERE student_id = $1`,
      [studentId],
    );
    return r.rows.length === 0 ? null : toCharacter(r.rows[0] as CharacterRow);
  }

  /**
   * The lesson-outcome write (the controller's lesson-end surface). Creates version 1
   * when no character exists (the birth snapshot — `partialBackfill` flags a creation
   * whose surface lacks an appearanceRef, the contract's `ip_backfill_partial` signal);
   * otherwise merges the patch over the current surface and bumps a version — unless the
   * merge changes nothing (idempotent no-op: retries/re-runs never grow the timeline).
   * Empty-string fields in the patch are IGNORED (a degraded lesson never erases canon).
   */
  async recordLessonOutcome(
    studentId: string,
    patch: IpCharacterSurface,
    updatedBy: IpCharacterProvenance,
  ): Promise<RefineOutcome> {
    validateSurface(patch);
    const cleaned = cleanPatch(patch);
    // appearanceRef is a JSONB pointer no FK can scope (workspace.md same-student pointer
    // discipline): UUID-shaped AND resolvable to THIS student's work, checked BEFORE any
    // write — a cross-student/cross-tenant or garbage ref must never be snapshotted into
    // the immutable timeline (or poison every later mirror).
    if (cleaned.appearanceRef !== undefined) {
      if (!UUID_RE.test(cleaned.appearanceRef)) {
        throw new WorkspaceServiceError("INVALID_INPUT", "appearanceRef is not a UUID");
      }
      const owned = await this.db.query(`SELECT 1 FROM works WHERE id = $1 AND student_id = $2`, [cleaned.appearanceRef, studentId]);
      if (owned.rows.length === 0) {
        throw new WorkspaceServiceError("INVALID_INPUT", "appearanceRef does not resolve to this student's work");
      }
    }
    const current = await this.getCharacter(studentId);
    if (!current) {
      // CONTRACT BACKFILL (ip-character.md): version 1 = the birth snapshot, seeded from
      // the EXISTING profile + the newest avatar work — a thin first patch must never
      // create a v1 (and mirror) that erases pre-4.5 companion state. `partialBackfill`
      // (the ip_backfill_partial signal) = no birth_certificate work exists.
      const { seed, hasCertificate } = await this.backfillSeed(studentId);
      const surface: IpCharacterSurface = { ...seed, ...cleaned };
      const created = await this.insertV1(studentId, surface, updatedBy);
      await this.mirror(studentId, surface);
      return { kind: "created", character: created, partialBackfill: !hasCertificate };
    }
    const merged: IpCharacterSurface = { ...current.surface, ...cleaned };
    if (deepEqual(merged, current.surface)) {
      // The mirror is idempotent and cheap — run it on the NO-OP path too, so a re-run
      // (the contract's recovery mechanism) HEALS a mirror an earlier crash left stale.
      await this.mirror(studentId, current.surface);
      return { kind: "noop", character: current };
    }
    const refined = await this.bumpVersion(current, merged, updatedBy);
    await this.mirror(studentId, merged);
    return { kind: "refined", character: refined };
  }

  /** Backfill sources (contract): the students row's genius_x fields + the newest
   *  avatar_image work (its id is the recoverable appearanceRef). */
  private async backfillSeed(studentId: string): Promise<{ seed: IpCharacterSurface; hasCertificate: boolean }> {
    const prof = await this.db.query(
      `SELECT genius_x_name, genius_x_personality_tag, genius_x_background_setting FROM students WHERE id = $1`,
      [studentId],
    );
    const p = (prof.rows[0] ?? {}) as { genius_x_name?: string | null; genius_x_personality_tag?: string | null; genius_x_background_setting?: string | null };
    const avatar = await this.db.query(
      `SELECT id FROM works WHERE student_id = $1 AND type = 'avatar_image' ORDER BY seq DESC LIMIT 1`,
      [studentId],
    );
    const cert = await this.db.query(
      `SELECT 1 FROM works WHERE student_id = $1 AND type = 'birth_certificate' LIMIT 1`,
      [studentId],
    );
    const seed: IpCharacterSurface = {};
    if (p.genius_x_name) seed.name = p.genius_x_name;
    if (p.genius_x_personality_tag) seed.personality = p.genius_x_personality_tag;
    if (p.genius_x_background_setting) seed.backstory = p.genius_x_background_setting;
    if (avatar.rows.length > 0) seed.appearanceRef = (avatar.rows[0] as { id: string }).id;
    return { seed, hasCertificate: cert.rows.length > 0 };
  }

  /** Version 1 — atomically: current row + the v1 snapshot (CTE; tenant derived). */
  private async insertV1(studentId: string, surface: IpCharacterSurface, updatedBy: IpCharacterProvenance): Promise<IpCharacter> {
    let result: { rows: unknown[] };
    try {
      result = await this.db.query(
        `WITH cur AS (
           INSERT INTO ip_characters (student_id, tenant_id, base_canon, surface, version, updated_by)
           SELECT s.id, s.tenant_id, $2, $3, 1, $4 FROM students s WHERE s.id = $1
           RETURNING student_id, tenant_id, base_canon, surface, version, updated_by, created_at, updated_at
         ), snap AS (
           INSERT INTO ip_character_versions (student_id, tenant_id, version, base_canon, surface, updated_by)
           SELECT student_id, tenant_id, 1, base_canon, surface, updated_by FROM cur
         )
         SELECT * FROM cur`,
        [studentId, JSON.stringify(BASE_CANON_V0), JSON.stringify(surface), JSON.stringify(updatedBy)],
      );
    } catch (err) {
      throw mapDb(err);
    }
    if (result.rows.length === 0) throw new WorkspaceServiceError("STUDENT_NOT_FOUND");
    return toCharacter(result.rows[0] as CharacterRow);
  }

  /** Refinement — atomically: bump current + insert the snapshot. base_canon UNTOUCHED. */
  private async bumpVersion(current: IpCharacter, surface: IpCharacterSurface, updatedBy: IpCharacterProvenance): Promise<IpCharacter> {
    let result: { rows: unknown[] };
    try {
      result = await this.db.query(
        `WITH cur AS (
           UPDATE ip_characters
           SET surface = $2, version = version + 1, updated_by = $3, updated_at = NOW()
           WHERE student_id = $1 AND version = $4
           RETURNING student_id, tenant_id, base_canon, surface, version, updated_by, created_at, updated_at
         ), snap AS (
           INSERT INTO ip_character_versions (student_id, tenant_id, version, base_canon, surface, updated_by)
           SELECT student_id, tenant_id, version, base_canon, surface, updated_by FROM cur
         )
         SELECT * FROM cur`,
        [current.studentId, JSON.stringify(surface), JSON.stringify(updatedBy), current.version],
      );
    } catch (err) {
      throw mapDb(err);
    }
    if (result.rows.length === 0) {
      // optimistic-concurrency miss (a parallel write bumped first) — the retry sees the
      // newer row and either no-ops or refines on top; surfaced as a typed conflict.
      throw new WorkspaceServiceError("INVALID_INPUT", "concurrent character refinement — retry");
    }
    return toCharacter(result.rows[0] as CharacterRow);
  }

  /**
   * Projected genius_x columns REPLACED from the canonical surface — EXCEPT
   * genius_x_avatar_url when the surface carries NO appearanceRef: a legacy URL written
   * by the pre-4.5 COALESCE writer may be UNRECOVERABLE as a work ref (the fire-and-forget
   * work write failed while the profile write succeeded) and must not be erased
   * (contract amendment, P4.5-A review). A later refinement WITH an appearanceRef
   * re-takes full ownership of the column.
   */
  private async mirror(studentId: string, surface: IpCharacterSurface): Promise<void> {
    if (surface.appearanceRef !== undefined) {
      const w = await this.db.query(
        `SELECT content_url FROM works WHERE id = $1 AND student_id = $2`, // same-student scoped
        [surface.appearanceRef, studentId],
      );
      const avatarUrl = w.rows.length > 0 ? ((w.rows[0] as { content_url: string | null }).content_url ?? null) : null;
      await this.db.query(
        `UPDATE students SET
           genius_x_name = $2, genius_x_avatar_url = $3,
           genius_x_personality_tag = $4, genius_x_background_setting = $5, updated_at = NOW()
         WHERE id = $1`,
        [studentId, surface.name ?? null, avatarUrl, surface.personality ?? null, surface.backstory ?? null],
      );
    } else {
      await this.db.query(
        `UPDATE students SET
           genius_x_name = $2,
           genius_x_personality_tag = $3, genius_x_background_setting = $4, updated_at = NOW()
         WHERE id = $1`, // avatar column untouched — legacy preservation
        [studentId, surface.name ?? null, surface.personality ?? null, surface.backstory ?? null],
      );
    }
  }
}

// --- helpers ---

interface CharacterRow {
  student_id: string; tenant_id: string;
  base_canon: { brandStyleVersion: string; baseForm: string };
  surface: IpCharacterSurface;
  version: number;
  updated_by: IpCharacterProvenance;
  created_at: unknown; updated_at: unknown;
}

function toCharacter(r: CharacterRow): IpCharacter {
  return {
    studentId: r.student_id,
    tenantId: r.tenant_id,
    baseCanon: r.base_canon,
    surface: r.surface,
    version: r.version,
    updatedBy: r.updated_by,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();

/** Per-field caps (owner matrix) — fail closed, the DB blob CHECK is the backstop. */
function validateSurface(p: IpCharacterSurface): void {
  if (p.name !== undefined && p.name.length > SURFACE_CAPS.name) throw new WorkspaceServiceError("INVALID_INPUT", "surface.name too long");
  if (p.appearanceRef !== undefined && p.appearanceRef.length > SURFACE_CAPS.appearanceRef) throw new WorkspaceServiceError("INVALID_INPUT", "surface.appearanceRef too long");
  if (p.personality !== undefined && p.personality.length > SURFACE_CAPS.personality) throw new WorkspaceServiceError("INVALID_INPUT", "surface.personality too long");
  if (p.backstory !== undefined && p.backstory.length > SURFACE_CAPS.backstory) throw new WorkspaceServiceError("INVALID_INPUT", "surface.backstory too long");
  if (p.appearanceTraits !== undefined) {
    if (p.appearanceTraits.length > SURFACE_CAPS.traits) throw new WorkspaceServiceError("INVALID_INPUT", "too many appearanceTraits");
    if (p.appearanceTraits.some((t) => t.length > SURFACE_CAPS.trait)) throw new WorkspaceServiceError("INVALID_INPUT", "appearanceTrait too long");
  }
}

/** Drop undefined AND empty-string fields — a degraded lesson outcome never erases canon. */
function cleanPatch(p: IpCharacterSurface): IpCharacterSurface {
  const out: IpCharacterSurface = {};
  if (p.name) out.name = p.name;
  if (p.appearanceRef) out.appearanceRef = p.appearanceRef;
  if (p.personality) out.personality = p.personality;
  if (p.backstory) out.backstory = p.backstory;
  if (p.appearanceTraits && p.appearanceTraits.length > 0) out.appearanceTraits = p.appearanceTraits;
  return out;
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, val]) => [k, sortKeys(val)]));
  }
  return v;
}

function mapDb(err: unknown): Error {
  const e = err as { code?: string; constraint?: string };
  if (e?.code === "23503") return new WorkspaceServiceError("STUDENT_NOT_FOUND", "student/tenant FK");
  if (e?.code === "23505") return new WorkspaceServiceError("INVALID_INPUT", "concurrent character refinement — retry");
  if (e?.code === "22P02") return new WorkspaceServiceError("INVALID_INPUT", "malformed identifier"); // backstop — validation should catch first
  return err instanceof Error ? err : new Error(String(err));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
