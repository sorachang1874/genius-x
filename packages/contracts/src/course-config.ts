/**
 * Lesson configuration schema — contracts v0 (frozen v0).
 * New lessons are data, not code (PRD §4.2). Both git JSON and (later) Payload CMS
 * exports MUST conform to this shape.
 */
import type { StageId, UnlockBy, ShapeVariant, TalentOption } from "./enums.js";

export interface LessonConfig {
  lessonId: string; // e.g. "lesson-001"
  lessonTitle: string;
  totalDuration: number; // minutes
  stages: StageConfig[];
}

/** Common fields every stage shares. */
export interface StageConfigBase {
  stageId: StageId;
  name: string;
  duration: number; // minutes
  unlockBy: UnlockBy;
}

/** What the app shows for non-AI / display stages (standby, intro, closure). */
export interface StageAppState {
  displayText?: string;
  avatarState?: string;
  startButtonLocked?: boolean;
  displayMode?: string;
}

/** AI interaction config per stage — discriminated by `type`. */
export type AiInteraction =
  | VoiceChatInteraction
  | ImageGenInteraction
  | StructuredQaInteraction
  | MultimodalTalentInteraction
  | BirthSpeechInteraction;

export interface VoiceChatInteraction {
  type: "voice_chat";
  promptTemplate: string; // e.g. "icebreak_v1" — versioned prompt contract
  maxTurns: number;
  thinkingAnimation?: string;
}

export interface ImageGenInteraction {
  type: "image_gen";
  model: string; // adapter id, NOT a hard provider binding (D3: provider-agnostic)
  outputCount: number; // candidate images
}

export interface StructuredQaInteraction {
  type: "structured_qa";
  promptTemplate: string;
  questions: StructuredQuestion[];
  promptAssembly?: string; // template that composes answers into an image prompt
}

export interface StructuredQuestion {
  id: string;
  text: string;
  options: string[];
}

export interface MultimodalTalentInteraction {
  type: "multimodal_talent";
  promptTemplate: string;
  options: TalentOption[];
  minInteractions: number;
  maxInteractions: number;
  memoryExtraction: boolean;
}

export interface BirthSpeechInteraction {
  type: "birth_speech";
  promptTemplate: string;
}

/** A stage node. `variants` present only for the shape stage (A/B lines). */
export interface StageConfig extends StageConfigBase {
  appState?: StageAppState;
  aiInteraction?: AiInteraction;
  variants?: ShapeVariant[];
  output?: ArtifactOutput;
}

export type ArtifactOutput = "birth_certificate";
