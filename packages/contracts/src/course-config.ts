/**
 * Lesson configuration schema — contracts v1. Generic: the engine interprets this; no stage
 * name is hardcoded in engine code (PRD §4.2). See docs/architecture/lesson-runtime.md.
 * A Zod validator (engine) checks every loaded config against this shape + the loaded
 * lesson's declared ids (fail closed).
 */
import type {
  StageId,
  UnlockBy,
  UnlockPolicy,
  OutputKey,
  MemoryKey,
  ArtifactType,
  StageStatus,
} from "./enums.js";

export interface LessonConfig {
  lessonId: string;
  lessonTitle: string;
  /** Bumped on any change; a session resumes only against a matching version. */
  lessonConfigVersion: string;
  totalDuration: number;
  unlockPolicy: UnlockPolicy;
  /** Ids this lesson is allowed to use — the validator checks references against these. */
  declaredOutputs: OutputKey[];
  declaredMemoryKeys: MemoryKey[];
  declaredArtifactTypes: ArtifactType[];
  stages: StageConfig[];
}

export interface StageConfig {
  stageId: StageId;
  name: string;
  duration: number; // minutes
  unlock: UnlockBy;
  advanceCondition: AdvanceCondition;
  /** Per-student A/B branch (e.g. shape doodle vs dialogue). Omit for a single interaction. */
  variants?: StageVariant[];
  /** Used when there are no variants. */
  interaction?: AiInteraction;
  appState?: StageAppState;
  /** Artifact produced by this stage (must be in declaredArtifactTypes). */
  output?: ArtifactType;
}

export interface StageVariant {
  id: string;
  label?: string;
  interaction: AiInteraction;
  /** Output slots this variant writes (must be in declaredOutputs). */
  writesOutputs?: OutputKey[];
}

// --- Advance conditions: declarative, composable, scoped ---

/** Evaluated against ONE student's runtime state. */
export type StudentPredicate =
  | { kind: "stageStatus"; is: StageStatus }
  | { kind: "minInteractions"; count: number }
  | { kind: "outputSet"; output: OutputKey } // a config-declared output is set
  | { kind: "variantSelected" };

/** Gates leaving a stage (in addition to the role-gated UNLOCK event). */
export type AdvanceCondition =
  | { type: "immediate" }
  | { type: "allStudents"; of: StudentPredicate }
  | { type: "countStudents"; min: number; of: StudentPredicate }
  | { type: "all"; conditions: AdvanceCondition[] }
  | { type: "any"; conditions: AdvanceCondition[] };

// --- AI interaction specs (generic option lists; ids validated at load) ---

export type AiInteraction =
  | VoiceChatInteraction
  | ImageGenInteraction
  | StructuredQaInteraction
  | MultimodalTalentInteraction
  | BirthSpeechInteraction;

export interface VoiceChatInteraction {
  type: "voice_chat";
  promptTemplate: string;
  maxTurns: number;
  thinkingAnimation?: string;
}

export interface ImageGenInteraction {
  type: "image_gen";
  model: string; // adapter id, NOT a hard provider binding (D3)
  outputCount: number;
}

export interface StructuredQaInteraction {
  type: "structured_qa";
  promptTemplate: string;
  questions: StructuredQuestion[];
  promptAssembly?: string;
}

export interface StructuredQuestion {
  id: string;
  text: string;
  options: string[];
}

export interface MultimodalTalentInteraction {
  type: "multimodal_talent";
  promptTemplate: string;
  options: string[];
  minInteractions: number;
  maxInteractions: number;
  memoryExtraction: boolean;
}

export interface BirthSpeechInteraction {
  type: "birth_speech";
  promptTemplate: string;
}

export interface StageAppState {
  displayText?: string;
  avatarState?: string;
  startButtonLocked?: boolean;
  displayMode?: string;
}
