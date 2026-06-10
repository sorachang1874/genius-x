/**
 * Parent share artifact — contracts v1 (Phase 3).
 *
 * Typed realization of `docs/contracts/parent-share.md`. The parent's FIRST product
 * surface: a read-only H5 opened via an unguessable capability URL (`?share=<token>`),
 * showing the child's birth certificate + works after class. No authentication until
 * Phase 3+ auth lands — the token IS the capability (hash-stored server-side, expiring,
 * uniform-404 on anything invalid).
 *
 * PRIVACY (binding, architecture §6.2/§12.2 + data-and-privacy.md): the view carries works
 * + curated summaries ONLY. The DENY list is explicit and tested:
 *   - NO interaction records / raw transcripts
 *   - NO operator metadata (aiParams, degraded, sessionId, stageId)
 *   - NO internal identifiers (studentId, tenantId, parentId, work ids)
 *   - NO raw memory rows (memories appear only as the certificate's curated labels)
 * Parent-facing copy follows the same no-"AI/Prompt/LLM/token/model" wording rule as the
 * child UI (the companion is a friend on every surface).
 */
import type { ArtifactType } from "./enums";

/** A work as the PARENT sees it — privacy-filtered, no internals. */
export interface SharedWork {
  /** Opaque lesson-declared type (the H5 renders per type, e.g. "avatar_image"). */
  type: ArtifactType;
  contentUrl?: string;
  contentText?: string;
  /** Structured content (e.g. the birth certificate JSON). */
  contentJson?: Record<string, unknown>;
  thumbnailUrl?: string;
  createdAt: string; // ISO
}

/** GET /share/:token response — everything the H5 needs, nothing it must not have. */
export interface ParentShareView {
  /** The child's display name (the one human identifier the capability URL grants). */
  studentDisplayName: string;
  lessonId: string;
  /**
   * The birth certificate's render-ready JSON (`BirthCertificate` shape from student.ts),
   * surfaced separately so the H5 can hero-render it. Absent if the lesson produced none.
   */
  certificate?: Record<string, unknown>;
  /** Other works, recency-first, privacy-filtered. The certificate is NOT repeated here. */
  works: SharedWork[];
  /** When this share was minted (lesson end). */
  sharedAt: string; // ISO
  /** Capability expiry — the H5 may show "链接有效期至…". */
  expiresAt: string; // ISO
}

// --- Mint (Classroom Service at lesson end, in-process; PLUS `POST /students/:id/share`
// at OPERATOR posture — same trust level as the identity admin endpoints, never
// internet-exposed; parent-share.md "Deployment exposure rule": the internet-facing proxy
// forwards ONLY `GET /share/*` + the static H5. Not parent/child-facing. The route's
// RESPONSE additionally carries the server-composed `url` (single URL composer) — an
// additive field on top of this frozen result shape.) ---

export interface MintShareRequest {
  studentId: string;
  lessonId: string;
}

/** The RAW token appears exactly once — in this result — and is never stored or logged. */
export interface MintShareResult {
  /** base64url, 256-bit. Goes into the capability URL: `<web>/?share=<token>`. */
  token: string;
  expiresAt: string; // ISO
}

// --- Error registry (public share endpoint) ---

/**
 * UNIFORM 404: unknown, expired, and revoked tokens are indistinguishable on the wire
 * (no existence/validity oracle). HTTP mapping: SHARE_NOT_FOUND → 404, INVALID_INPUT → 400
 * (malformed token shape only). Undefined failures: sanitized 500 (enrollment.md v1.1 rule).
 */
export type ShareErrorCode = "SHARE_NOT_FOUND" | "INVALID_INPUT";

export interface ShareErrorResponse {
  error: ShareErrorCode;
  detail?: string; // operator-facing only; never the raw token
}
