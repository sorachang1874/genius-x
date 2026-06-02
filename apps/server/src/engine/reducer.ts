/**
 * Generic lesson reducer — `(state, EngineEvent, now) => EngineResult`. Pure: emits
 * EngineCommands (effects) rather than performing them; no stage name is hardcoded; advances
 * by config + guards. See docs/architecture/lesson-runtime.md, docs/contracts/course-engine.md.
 */
import type {
  LessonConfig,
  ClassSession,
  StudentRuntimeState,
  EngineEvent,
  EngineResult,
  EngineCommand,
  StageId,
  TraceEvent,
  StageCompletePayload,
} from "@genius-x/contracts";
import { evalAdvanceCondition } from "./guards";
import { nextStageId, stageById } from "./nextStage";

export type Reducer = (state: ClassSession, event: EngineEvent, now: string) => EngineResult;

export function makeReducer(lesson: LessonConfig): Reducer {
  return (state, event, now) => reduce(lesson, state, event, now);
}

function reduce(
  lesson: LessonConfig,
  state: ClassSession,
  event: EngineEvent,
  now: string,
): EngineResult {
  switch (event.type) {
    case "UNLOCK":
      return tryAdvance(lesson, state, now, {
        targetStageId: event.stageId,
        role: event.role,
        forced: false,
      });
    case "FORCE_ADVANCE":
      return tryAdvance(lesson, state, now, {
        targetStageId: event.stageId,
        forced: true,
        assistantId: event.assistantId,
        reason: event.reason,
      });
    case "STUDENT_COMPLETE":
      return updateStudent(state, event.studentId, now, (s) =>
        applyCompletion(s, event.stageId, event.payload),
      );
    case "INTERACTION_DONE":
      return updateStudent(state, event.studentId, now, (s) => ({
        ...s,
        interactionCounts: {
          ...s.interactionCounts,
          [event.stageId]: (s.interactionCounts[event.stageId] ?? 0) + 1,
        },
        completedInteractionIds: [...s.completedInteractionIds, event.interactionId],
      }));
    case "GLOBAL": {
      const next: ClassSession = { ...state, global: event.state };
      return {
        state: next,
        commands: [
          { type: "BROADCAST", message: { type: "GLOBAL_STATE", state: event.state } },
          { type: "PERSIST" },
        ],
      };
    }
    default: {
      const _exhaustive: never = event;
      return { state, commands: [] };
    }
  }
}

interface AdvanceArgs {
  targetStageId: StageId;
  role?: "teacher" | "assistant" | undefined;
  forced: boolean;
  assistantId?: string | undefined;
  reason?: string | undefined;
}

function tryAdvance(
  lesson: LessonConfig,
  state: ClassSession,
  now: string,
  args: AdvanceArgs,
): EngineResult {
  const current = stageById(lesson, state.currentStageId);
  const nextId = nextStageId(lesson, state.currentStageId);
  if (!current || nextId === null) return denied(state, now, "no next stage");
  const next = stageById(lesson, nextId);
  if (!next) return denied(state, now, "next stage not found");
  if (args.targetStageId !== nextId)
    return denied(state, now, `target ${args.targetStageId} != next ${nextId}`);

  if (!args.forced) {
    if (args.role !== next.unlock)
      return denied(state, now, `role ${String(args.role)} cannot unlock ${nextId}`);
    if (!evalAdvanceCondition(current.advanceCondition, state, state.currentStageId))
      return denied(state, now, `advance condition not met for ${state.currentStageId}`);
  }

  // mark the new stage in_progress for every student
  const students: Record<string, StudentRuntimeState> = {};
  for (const [id, s] of Object.entries(state.students)) {
    students[id] = { ...s, stageStatus: { ...s.stageStatus, [nextId]: "in_progress" } };
  }
  const nextState: ClassSession = {
    ...state,
    currentStageId: nextId,
    stageStartTime: now,
    global: "active",
    students,
  };
  const trace: TraceEvent = {
    at: now,
    kind: args.forced ? "force_advance" : "stage_transition",
    stageId: nextId,
    payload: args.forced
      ? { from: state.currentStageId, assistantId: args.assistantId, reason: args.reason }
      : { from: state.currentStageId },
  };
  const commands: EngineCommand[] = [
    { type: "BROADCAST", message: { type: "STAGE_UNLOCK", stageId: nextId } },
    { type: "PERSIST" },
    { type: "TRACE", event: trace },
  ];
  return { state: nextState, commands };
}

/** Illegal/blocked transition: state unchanged, logged for operators, never shown to a child. */
function denied(state: ClassSession, now: string, reason: string): EngineResult {
  const trace: TraceEvent = {
    at: now,
    kind: "stage_transition",
    stageId: state.currentStageId,
    payload: { denied: true, code: "STAGE_TRANSITION_DENIED", reason },
  };
  return { state, commands: [{ type: "TRACE", event: trace }] };
}

function updateStudent(
  state: ClassSession,
  studentId: string,
  now: string,
  fn: (s: StudentRuntimeState) => StudentRuntimeState,
): EngineResult {
  const s = state.students[studentId];
  if (!s) {
    return denied(state, now, `unknown student ${studentId}`);
  }
  const nextState: ClassSession = {
    ...state,
    students: { ...state.students, [studentId]: fn(s) },
  };
  return { state: nextState, commands: [{ type: "PERSIST" }] };
}

function applyCompletion(
  s: StudentRuntimeState,
  stageId: StageId,
  payload: StageCompletePayload,
): StudentRuntimeState {
  const base: StudentRuntimeState = {
    ...s,
    stageStatus: { ...s.stageStatus, [stageId]: "completed" },
  };
  switch (payload.kind) {
    case "selection":
      return { ...base, outputs: { ...base.outputs, [payload.output]: payload.value } };
    case "variantChoice":
      return { ...base, selectedVariant: { ...base.selectedVariant, [stageId]: payload.variantId } };
    case "voice":
    case "doodle":
    case "interaction":
      return base;
    default: {
      const _exhaustive: never = payload;
      return _exhaustive;
    }
  }
}
