/**
 * Engine event + command contracts — contracts v1. The lesson-runtime reducer is
 * `(state, EngineEvent) => { state, EngineCommand[] }`. Typing both the inputs and the
 * effect-commands keeps AI calls / sockets / DB writes OUT of reducer logic, and stops
 * agents inventing incompatible side-effect shapes. See docs/architecture/lesson-runtime.md.
 */
import type { StageId, GlobalState, UnlockBy, MemoryKey } from "./enums";
import type { StageCompletePayload, InteractionInput, ServerMessage, ClientAiOutput, OutputKind } from "./ws-events";
import type { TraceEvent } from "./ai-response";
import type { ClassSession, PreparedOutputId } from "./student";

/** Inputs the reducer folds over. */
export type EngineEvent =
  | { type: "UNLOCK"; role: UnlockBy; stageId: StageId; assistantId?: string }
  | { type: "INTERACT"; studentId: string; stageId: StageId; interactionId: string; variantId?: string; input: InteractionInput }
  | { type: "STUDENT_COMPLETE"; studentId: string; stageId: StageId; payload: StageCompletePayload }
  | { type: "INTERACTION_DONE"; studentId: string; stageId: StageId; interactionId: string; degraded: boolean }
  /** A talent memory extraction settled (contracts-v1.4). `memory` absent on null/invalid/timeout —
   *  always fed back so `pendingMemory` drains. Drives birth pre-gen readiness (maybePrepareBirth). */
  | { type: "MEMORY_EXTRACTION_DONE"; studentId: string; stageId: StageId; interactionId: string; memory?: { key: MemoryKey; value: string } }
  /** A pre-generated output finished (contracts-v1.4); fills the reducer-minted `prepared` placeholder. */
  | { type: "PREPARE_DONE"; studentId: string; stageId: StageId; preparedId: PreparedOutputId; output: ClientAiOutput; outputKind: OutputKind; degraded: boolean }
  | { type: "GLOBAL"; state: GlobalState }
  | { type: "FORCE_ADVANCE"; stageId: StageId; assistantId: string; reason?: string; expectedCurrentStageId?: StageId };

/** Effects the reducer emits (executed by the runtime, never inside reducer logic). */
export type EngineCommand =
  | { type: "CALL_INTERACTION"; studentId: string; stageId: StageId; interactionId: string; variantId?: string; input: InteractionInput }
  /** Pre-generate an output for a student (e.g. birth speech). `preparedId` is reducer-minted;
   *  `promptVersion`/`outputKind` come from the stage's `birth_speech` interaction config. */
  | { type: "CALL_PREPARE"; studentId: string; stageId: StageId; preparedId: PreparedOutputId; promptVersion: string; outputKind: OutputKind }
  | { type: "BROADCAST"; message: ServerMessage }
  | { type: "PERSIST" }
  | { type: "TRACE"; event: TraceEvent };

/** The reducer's typed return: next authoritative state + effects to execute. */
export interface EngineResult {
  state: ClassSession;
  commands: EngineCommand[];
}
