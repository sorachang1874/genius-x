/**
 * Student data model — contracts v0 (DRAFT, pending freeze).
 * Source: PRD §6, §7.5. Privacy/retention rules: docs/contracts/data-and-privacy.md.
 */
import type {
  StageId,
  ArtifactType,
  MemoryKey,
} from "./enums.js";

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
  name?: string; // confirmed in Lesson 2 (D1) — stays optional in Lesson 1
  avatarUrl?: string; // chosen in shape stage
  personalityTag?: string; // extracted in talent
  backgroundSetting?: string; // from shape choices
  memories: Memory[];
  birthdaySpeech?: string;
}

export interface Memory {
  key: MemoryKey;
  value: string;
  collectedAt: string; // source stage id
  lessonId: number;
}

export interface Progress {
  currentLesson: number;
  currentPhase: number;
  completedStages: StageId[];
  badges: string[];
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  contentUrl?: string;
  contentText?: string;
  lessonId: number;
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
  memories: { label: string; value: string }[]; // up to 3 shown
  birthdaySpeech: string; // TTS audio URL or text
  generatedAt: string; // ISO
  lessonId: number;
}

/** Live class session — Redis during class, archived to Postgres after (PRD §6.2). */
export interface ClassSession {
  sessionId: string;
  lessonId: string;
  classId: string;
  currentStage: StageId; // authoritative class-wide state
  stageStartTime: string; // ISO
  students: Record<string, StudentSessionState>;
  assistants: string[];
}

export interface StudentSessionState {
  stageStatus: "waiting" | "in_progress" | "completed";
  stageData: Record<string, unknown>;
}
