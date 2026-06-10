/**
 * IP character — typed realization of docs/contracts/ip-character.md (Phase 4.5).
 *
 * The product anchor (2026-06-09 founder-ratified reframe): each child's personal IP
 * character — born in lesson-001 (出生证 = version 1.0 snapshot), continuously refined
 * across lessons. LAYERED MODEL (decision ③/④, principle P2):
 *   - base canon: essential 伙伴 form + brand DNA — LOCKED (changes only via lead-serialized
 *     brand-version migration, never the runtime/child)
 *   - refinable surface: name/appearance/personality/backstory — child-refined through
 *     scene outcomes; every accepted refinement = a new immutable VERSION snapshot
 *   - temporary skins: crossover/costume displays — recorded as works only, NEVER mutate
 *     canon or surface
 *
 * Source-of-truth transition: `ip_characters` becomes canonical when Phase 4.5 ships;
 * identity's GeniusXProfile becomes a derived mirror (single writer: the IP character
 * service), then deprecates. See the contract's migration table.
 */

/** The locked base layer. Changes ONLY via a lead-serialized brand-version migration. */
export interface IpCharacterBaseCanon {
  /** Brand DNA version this character is anchored to (brand-style.md). */
  brandStyleVersion: string;
  /** The essential 「伙伴」 base form descriptor — never overwritten by refinements/skins. */
  baseForm: string;
}

/** The child-refinable layer. Each accepted refinement bumps the version. */
export interface IpCharacterSurface {
  name?: string;
  /** Pointer to the current avatar work (the canonical "what my friend looks like"). */
  appearanceRef?: string;
  /** Appearance descriptors — per-child conditioning input for generation consistency. */
  appearanceTraits?: string[];
  personality?: string;
  backstory?: string;
  /** Future additive: vocalRef, videoRef, … (contract: additive fields only). */
}

/** Provenance of a refinement (operator-tier; never parent/child-served raw). */
export interface IpCharacterProvenance {
  lessonId: string;
  sessionId?: string;
  stageId?: string;
}

/** Current state — one per student (`ip_characters` row). */
export interface IpCharacter {
  studentId: string;
  tenantId: string;
  baseCanon: IpCharacterBaseCanon;
  surface: IpCharacterSurface;
  /** Current version number (≥ 1; version 1 = the lesson-001 birth snapshot). */
  version: number;
  updatedBy: IpCharacterProvenance;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

/** Immutable version snapshot — the growth timeline (`ip_character_versions` row). */
export interface IpCharacterVersion {
  id: string; // UUID
  studentId: string;
  tenantId: string;
  version: number;
  baseCanon: IpCharacterBaseCanon;
  surface: IpCharacterSurface;
  updatedBy: IpCharacterProvenance;
  createdAt: string; // ISO
}
