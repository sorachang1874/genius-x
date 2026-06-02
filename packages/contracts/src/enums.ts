/**
 * Shared enums — contracts v0 (DRAFT, pending freeze).
 * Source: genius-x-mvp-prd.md §4.1, §6, §7.
 */

/** The fixed lesson stage sequence (PRD §4.1). */
export type StageId =
  | "standby"
  | "intro"
  | "icebreak"
  | "shape"
  | "talent"
  | "birth"
  | "closure";

export type Role = "student" | "assistant" | "teacher" | "parent" | "admin";

/** Who unlocks a stage (PRD §4.2). */
export type UnlockBy = "teacher" | "assistant";

/** Per-student status within a stage (PRD §6.2). */
export type StageStatus = "waiting" | "in_progress" | "completed";

/** Shape stage branches (PRD §7.3): doodle (A-line) or dialogue (B-line). */
export type ShapeVariant = "drawing" | "dialogue";

/** Talent interaction options (PRD §7.4). */
export type TalentOption = "sing" | "story" | "question" | "draw";

/** Artifact kinds a child produces (PRD §6.1). */
export type ArtifactType =
  | "drawing"
  | "story"
  | "poem"
  | "voice"
  | "birth_certificate";

/** Memory data points collected during talent (PRD §5.3.3, §7.4, appendix B2). */
export type MemoryKey =
  | "favorite_toy"
  | "favorite_animal"
  | "best_friend"
  | "favorite_color"
  | "favorite_food"
  | "preferred_name";

/** Runtime modes — never inferred from ad-hoc env vars (playbook runtime isolation). */
export type RuntimeMode = "local" | "scripted" | "live" | "production";
