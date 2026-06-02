/**
 * Student data model — contracts v1. Source: PRD §6, §7.5. Privacy/retention:
 * docs/contracts/data-and-privacy.md.
 *
 * KEY CHANGE (post review): runtime state splits **engine-owned typed fields** from
 * **config-declared opaque outputs** — so a new lesson's outputs never force a contract
 * migration. Stage/memory/artifact ids are opaque (validated against the loaded lesson).
 */
import type {
  StageId,
  ArtifactType,
  MemoryKey,
  OutputKey,
  RuntimeValue,
  StageStatus,
  GlobalState,
} from "./enums";

export interface StudentProfile {
  id: string; // UUID
  name: string;
  age: number;
  courseId: string;
  geniusX: GeniusX;
  progress: Progress;
  artifacts: Artifact[];
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface GeniusX {
  name?: string; // confirmed in Lesson 2 (D1) — optional in Lesson 1
  avatarUrl?: string;
  personalityTag?: string;
  backgroundSetting?: string;
  memories: Memory[];
  birthdaySpeech?: string;
}

export interface Memory {
  key: MemoryKey; // opaque, config-declared
  value: string;
  collectedAt: StageId; // source stage id
  lessonId: string; // the LessonConfig.lessonId (e.g. "lesson-001")
}

export interface Progress {
  currentLesson: number;
  currentPhase: number;
  completedStageIds: StageId[]; // opaque ids
  badges: string[];
}

export interface Artifact {
  id: string;
  type: ArtifactType; // opaque, config-declared
  contentUrl?: string;
  contentText?: string;
  lessonId: string; // the LessonConfig.lessonId (e.g. "lesson-001")
  stageId: StageId;
  createdAt: string; // ISO
}

/** Birth certificate — the Lesson 1 core output (PRD §7.5). */
export interface BirthCertificate {
  studentName: string;
  geniusXName?: string; // may be blank in Lesson 1 (D1)
  avatarUrl: string;
  personalityTag: string;
  backgroundSetting: string;
  memories: { label: string; value: string }[];
  birthdaySpeech: string;
  generatedAt: string; // ISO
  lessonId: string; // the LessonConfig.lessonId (e.g. "lesson-001")
}

// --- Live runtime state (Redis during class, archived to Postgres after) ---

/** Per-student state the engine reduces + guards read. Engine fields are typed; lesson
 *  outputs are opaque (config-declared) so new lessons add outputs without a contract change. */
export interface StudentRuntimeState {
  /** Engine-owned, typed. */
  stageStatus: Record<StageId, StageStatus>;
  interactionCounts: Record<StageId, number>;
  completedInteractionIds: string[];
  selectedVariant: Record<StageId, string>; // stageId → variantId
  /** Config-declared outputs (e.g. "avatarUrl"). Keys must be in lesson.declaredOutputs. */
  outputs: Record<OutputKey, RuntimeValue>;
}

export interface ClassSession {
  sessionId: string;
  lessonId: string;
  lessonConfigVersion: string; // resume only against a matching version (fail closed)
  classId: string;
  currentStageId: StageId; // authoritative class-wide state
  global: GlobalState;
  stageStartTime: string; // ISO
  students: Record<string, StudentRuntimeState>;
  assistants: string[];
}
