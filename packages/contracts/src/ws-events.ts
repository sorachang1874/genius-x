/**
 * WebSocket classroom-sync messages — contracts v0 (frozen v0).
 * Source: PRD §8.1. Carried over Socket.IO; the server holds authoritative state and
 * clients resume from it on reconnect (PRD §8.2).
 */
import type { StageId } from "./enums.js";

/** Server → client. */
export type ServerMessage =
  | { type: "STAGE_UNLOCK"; stageId: StageId }
  | { type: "GLOBAL_STATE"; state: "closure" | "standby" }
  | { type: "AI_READY"; studentId: string }
  /** Sent on (re)connect so a refreshed iPad resumes to the authoritative state. */
  | { type: "RESUME_STATE"; currentStage: StageId; global: "active" | "closure" | "standby" };

/** Client → server. */
export type ClientMessage =
  | { type: "STAGE_COMPLETE"; studentId: string; stageId: StageId; data: unknown }
  | { type: "ASSISTANT_UNLOCK"; stageId: StageId; assistantId: string }
  | { type: "REQUEST_PROJECTION"; studentId: string }
  /** Sent on connect to request the current authoritative state. */
  | { type: "HELLO"; studentId: string };

export type ClassroomEvent = ServerMessage | ClientMessage;
