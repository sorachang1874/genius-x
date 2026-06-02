/**
 * Engine event + command contracts — contracts v1. The lesson-runtime reducer is
 * `(state, EngineEvent) => { state, EngineCommand[] }`. Typing both the inputs and the
 * effect-commands keeps AI calls / sockets / DB writes OUT of reducer logic, and stops
 * agents inventing incompatible side-effect shapes. See docs/architecture/lesson-runtime.md.
 */
import type { StageId, GlobalState, UnlockBy } from "./enums.js";
import type { StageCompletePayload, ServerMessage } from "./ws-events.js";
import type { TraceEvent } from "./ai-response.js";
import type { ClassSession } from "./student.js";

/** Inputs the reducer folds over. */
export type EngineEvent =
  | { type: "UNLOCK"; role: UnlockBy; stageId: StageId; assistantId?: string }
  | { type: "STUDENT_COMPLETE"; studentId: string; stageId: StageId; payload: StageCompletePayload }
  | { type: "INTERACTION_DONE"; studentId: string; stageId: StageId; interactionId: string; degraded: boolean }
  | { type: "GLOBAL"; state: GlobalState }
  | { type: "FORCE_ADVANCE"; stageId: StageId; assistantId: string; reason?: string };

/** Effects the reducer emits (executed by the runtime, never inside reducer logic). */
export type EngineCommand =
  | { type: "CALL_INTERACTION"; studentId: string; stageId: StageId; variantId?: string }
  | { type: "BROADCAST"; message: ServerMessage }
  | { type: "PERSIST" }
  | { type: "TRACE"; event: TraceEvent };

/** The reducer's typed return: next authoritative state + effects to execute. */
export interface EngineResult {
  state: ClassSession;
  commands: EngineCommand[];
}
