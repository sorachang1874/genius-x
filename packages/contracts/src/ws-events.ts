/**
 * WebSocket classroom-sync messages — contracts v1. Source: PRD §8.1. Carried over Socket.IO;
 * the server holds authoritative state, clients resume from it (PRD §8.2).
 *
 * PRIVACY (data-and-privacy contract): payloads carry **refs**, never raw bytes/base64 — no
 * raw child audio crosses this boundary. `STAGE_COMPLETE` is a typed union, not `unknown`.
 */
import type { StageId, OutputKey, RuntimeValue, GlobalState } from "./enums";
import type { StudentRuntimeState, PreparedOutputId } from "./student";

/** Opaque storage references — NOT raw media bytes. */
export type AudioRef = string;
export type ImageRef = string;
export type DoodleRef = string;

/** A student's interaction INPUT (drives an AI call). Typed — refs, never raw bytes. */
export type InteractionInput =
  | { kind: "voice"; audioRef: AudioRef } // icebreak, talent follow-up
  | { kind: "doodle"; doodleRef: DoodleRef } // shape A-line
  | { kind: "answers"; answersByQuestionId: Record<string, string> } // shape B-line dialogue
  | { kind: "talentOption"; option: string } // talent pick
  | { kind: "talentAnswer"; option?: string; audioRef: AudioRef }
  | { kind: "playPrepared"; preparedId: PreparedOutputId }; // birth: replay a server pre-generated output

/** A student's CHOICE / finish (not an interaction). Source: D-M2 v2 (Codex #3). */
export type StageCompletePayload =
  | { kind: "selection"; output: OutputKey; value: RuntimeValue } // e.g. avatar chosen
  | { kind: "variantChoice"; variantId: string } // chose shape A vs B line
  | { kind: "done" }; // finished this stage's required action

/** Child-renderable AI output — NOT AiResult (meta stays server-side). Source: D-M2 v2 (Codex #4). */
export type OutputKind = "text" | "audio" | "images";
export interface ClientAiOutput {
  text?: string;
  audioUrl?: string;
  imageUrls?: string[];
}

/** Server → client. */
export type ServerMessage =
  | { type: "STAGE_UNLOCK"; stageId: StageId }
  | { type: "GLOBAL_STATE"; state: GlobalState }
  /** A pre-generated output is ready; the child replays it with INTERACT{playPrepared,preparedId}. */
  | { type: "AI_READY"; studentId: string; stageId: StageId; preparedId: PreparedOutputId; outputKind: OutputKind }
  | { type: "AI_OUTPUT"; studentId: string; stageId: StageId; interactionId: string; output: ClientAiOutput }
  /** Project a child's renderable output to the teacher/big-screen audience (REQUEST_PROJECTION). */
  | { type: "PROJECT"; studentId: string; output: ClientAiOutput }
  /** Full resume payload: enough to restore the client without inventing state. */
  | {
      type: "RESUME_STATE";
      currentStageId: StageId;
      global: GlobalState;
      lessonConfigVersion: string;
      you: StudentRuntimeState;
    };

/** Client → server. */
export type ClientMessage =
  | { type: "HELLO"; studentId?: string; assistantId?: string }
  | { type: "ASSISTANT_UNLOCK"; stageId: StageId; assistantId: string }
  /** Teacher-gated advance (e.g. closure). In MVP the main teacher acts via the assistant
   *  device; the server should verify the connection's role when auth lands (currently trusted). */
  | { type: "TEACHER_UNLOCK"; stageId: StageId }
  /** Explicit, audited assistant override so one straggler never freezes the class. */
  | {
      type: "FORCE_ADVANCE";
      stageId: StageId;
      assistantId: string;
      reason?: string;
      expectedCurrentStageId?: StageId;
    }
  /** An interaction input (triggers an AI call). interactionId makes the lifecycle idempotent. */
  | {
      type: "INTERACT";
      studentId: string;
      stageId: StageId;
      interactionId: string;
      variantId?: string;
      input: InteractionInput;
    }
  | {
      type: "STAGE_COMPLETE";
      studentId: string;
      stageId: StageId;
      payload: StageCompletePayload;
    }
  /** Project a child's prepared output to the big screen. `requestedBy` is the control-surface
   *  (assistant/teacher) id — student-origin requests are denied + traced (full RBAC = Better Auth). */
  | { type: "REQUEST_PROJECTION"; studentId: string; requestedBy: string };

export type ClassroomEvent = ServerMessage | ClientMessage;
