/**
 * Shared enums + opaque id types — contracts v1.
 *
 * KEY CHANGE (v0→v1, post independent review): ids that lessons extend (stage, memory,
 * artifact, output) are **opaque strings validated at runtime against the loaded lesson**,
 * NOT closed enums. A closed enum would mean "the system only knows Lesson 1" and would
 * force a frozen-contract migration for every new lesson/CMS config. The Lesson-1 unions are
 * kept only as documentation/test aliases and must NOT appear in wire/persistence types.
 */

// --- Opaque ids carried on the wire + in persistence (validated against the loaded lesson) ---
export type StageId = string;
export type MemoryKey = string;
export type ArtifactType = string;
/** A config-declared per-student output slot (e.g. "avatarUrl"). */
export type OutputKey = string;

/** Values a student output / runtime field can hold. */
export type RuntimeValue = string | number | boolean | string[];

// --- Engine-owned (typed; the engine controls these, not lesson config) ---
export type StageStatus = "waiting" | "in_progress" | "completed";

/** Whole-class sync state (generalized from v0's "closure"|"standby"). */
export type GlobalState = "active" | "synced_intro" | "synced_closure" | "standby";

export type Role = "student" | "assistant" | "teacher" | "parent" | "admin";
export type UnlockBy = "teacher" | "assistant";

/** Unlock scope. v1 implements classWide only; field exists for forward-compat. */
export type UnlockPolicy = "classWide";

/** Runtime modes — never inferred from ad-hoc env vars (playbook runtime isolation). */
export type RuntimeMode = "local" | "scripted" | "live" | "production";

// --- Lesson-1 documentation/test aliases (NOT for wire/persistence types) ---
export type Lesson1StageId =
  | "standby" | "intro" | "icebreak" | "shape" | "talent" | "birth" | "closure";
export type Lesson1MemoryKey =
  | "favorite_toy" | "favorite_animal" | "best_friend"
  | "favorite_color" | "favorite_food" | "preferred_name";
