/**
 * Playground (乐园) v0 — typed realization of agent-session.md v1 (session lifecycle)
 * and world.md v1 (the friend's home, zero-AI floor objects).
 *
 * v0 is READ-ONLY (agent-session.md gate ⑤: no playground DB writes until the
 * data-and-privacy upgrade + workspace mode discriminator land). The world view serves
 * the child's OWN assets through a one-student playground token — the parent-share DENY
 * discipline extends (no transcripts/episodes/aiParams/internal ids on the wire).
 */
import type { SharedWork } from "./parent-share";

/** One wall item: the curated latest work of a type + its replayable polish slices. */
export interface WorldWallItem {
  type: string;
  final: SharedWork;
  /** 打磨轨迹 — evenly sampled drafts for the tap-to-replay animation (may be empty). */
  slices: SharedWork[];
}

/** One album page: a character version snapshot (surface only — never base canon). */
export interface WorldAlbumPage {
  version: number;
  surface: { name?: string; personality?: string; backstory?: string };
  createdAt: string; // ISO
}

/** One open-diary entry (world.md: `companion_diary` → 摊开的日记). */
export interface WorldDiaryEntry {
  summary: string;
  createdAt: string; // ISO
}

/** GET /playground/world — everything the v0 home renders, in one fetch. */
export interface PlaygroundWorldView {
  displayName: string;
  /** The friend's visit greeting (L1: deterministic from the newest episode) —
   *  absent ⇒ the client's generic warm line (cold-miss is never child-visible). */
  greeting?: string;
  /** 摊开的日记 — newest first, curated entries only (deterministic v1). */
  diary: WorldDiaryEntry[];
  /** The companion's parent-visible surface (form-agnostic — name/personality only). */
  companion?: { name?: string; personality?: string };
  wall: WorldWallItem[];
  album: WorldAlbumPage[];
  /** Session end (ISO) — the client renders the sleepy wind-down as it approaches. */
  sessionExpiresAt: string;
  /** Server clock at serve time (ISO) — the client anchors its wind-down timers on
   *  (sessionExpiresAt - serverNow), so a skewed child-device clock costs only network
   *  latency, never quota truthfulness. */
  serverNow: string;
}

/** Mint result (parent door, parent-surface.md v1.2) — the raw token appears once. */
export interface PlaygroundSessionResult {
  token: string; // 43-char base64url
  expiresAt: string; // ISO — quota + grace
}
