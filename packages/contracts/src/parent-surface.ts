/**
 * Parent surface — typed realization of docs/contracts/parent-surface.md (Phase 6).
 *
 * The AUTHENTICATED parent home (decision ②'s third layer): all children, each child's
 * growth timeline (the IP character's版本史, SURFACE-only projection) and full works
 * history — plus co-working v1: a reviewed parent note the companion relays ONCE.
 * Privacy: the parent-share DENY discipline extends (no transcripts, no episodes pending
 * the founder decision, no operator metadata, no base_canon internals).
 */
import type { SharedWork } from "./parent-share";

/** One child on the parent home. */
export interface ParentChildSummary {
  studentId: string; // the route's own scope key — the one internal id this surface owns
  displayName: string;
  age: number;
  /** The PARENT-visible companion canon (surface projection — never base_canon). */
  companion?: { name?: string; personality?: string; backstory?: string };
  completedLessonIds: string[];
}

/** One growth-timeline entry: a character version + the artifacts depicting it. */
export interface GrowthTimelineEntry {
  version: number;
  surface: { name?: string; personality?: string; backstory?: string };
  lessonId: string;
  createdAt: string; // ISO
  /** Lineage works (privacy-filtered like the share view). */
  works: SharedWork[];
}

export interface ParentTimelineResponse {
  studentId: string;
  displayName: string;
  entries: GrowthTimelineEntry[]; // version ASC — the growth story
}

/** Mint result (operator posture) — the raw token appears exactly once. */
export interface ParentAccessResult {
  token: string; // 43-char base64url
  expiresAt: string; // ISO
}

export interface AddParentNoteRequest {
  text: string; // 1-200 chars, safety-reviewed BEFORE storage
}
