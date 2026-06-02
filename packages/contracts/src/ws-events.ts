/**
 * WebSocket classroom-sync messages — contracts v1. Source: PRD §8.1. Carried over Socket.IO;
 * the server holds authoritative state, clients resume from it (PRD §8.2).
 *
 * PRIVACY (data-and-privacy contract): payloads carry **refs**, never raw bytes/base64 — no
 * raw child audio crosses this boundary. `STAGE_COMPLETE` is a typed union, not `unknown`.
 */
import type { StageId, OutputKey, RuntimeValue, GlobalState } from "./enums.js";
import type { StudentRuntimeState } from "./student.js";

/** Opaque storage references — NOT raw media bytes. */
export type AudioRef = string;
export type ImageRef = string;
export type DoodleRef = string;

/** What a student submits to complete (part of) a stage. Typed — no raw audio, no `unknown`. */
export type StageCompletePayload =
  | { kind: "voice"; audioRef: AudioRef }
  | { kind: "doodle"; doodleRef: DoodleRef }
  | { kind: "variantChoice"; variantId: string }
  | { kind: "selection"; output: OutputKey; value: RuntimeValue } // e.g. avatar chosen
  | { kind: "interaction"; interactionId: string };

/** Server → client. */
export type ServerMessage =
  | { type: "STAGE_UNLOCK"; stageId: StageId }
  | { type: "GLOBAL_STATE"; state: GlobalState }
  | { type: "AI_READY"; studentId: string; stageId: StageId }
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
  | { type: "HELLO"; studentId: string }
  | { type: "ASSISTANT_UNLOCK"; stageId: StageId; assistantId: string }
  /** Explicit, audited assistant override so one straggler never freezes the class. */
  | {
      type: "FORCE_ADVANCE";
      stageId: StageId;
      assistantId: string;
      reason?: string;
      expectedCurrentStageId?: StageId;
    }
  | {
      type: "STAGE_COMPLETE";
      studentId: string;
      stageId: StageId;
      payload: StageCompletePayload;
    }
  | { type: "REQUEST_PROJECTION"; studentId: string };

export type ClassroomEvent = ServerMessage | ClientMessage;
