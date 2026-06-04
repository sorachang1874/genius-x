/**
 * Generic lesson reducer — `(state, EngineEvent, now) => EngineResult`. Pure: emits
 * EngineCommands (effects) rather than performing them; no stage name is hardcoded; advances
 * by config + guards. See docs/architecture/lesson-runtime.md, docs/contracts/course-engine.md.
 *
 * Safety: student events are accepted only for the CURRENT stage and validated against the
 * lesson's declarations; interactions are idempotent by id; FORCE_ADVANCE requires a known
 * assistant. Illegal events leave state unchanged and emit an operator-visible TRACE.
 */
import type {
  LessonConfig,
  StageConfig,
  ClassSession,
  StudentRuntimeState,
  EngineEvent,
  EngineResult,
  EngineCommand,
  StageId,
  TraceEvent,
  StageCompletePayload,
  InteractionInput,
  PreparedOutput,
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
        expectedStageId: event.expectedCurrentStageId,
      });
    case "INTERACT":
      return onInteract(lesson, state, now, event);
    case "STUDENT_COMPLETE":
      return onStudentComplete(lesson, state, now, event);
    case "INTERACTION_DONE":
      return onInteractionDone(state, now, event);
    case "MEMORY_EXTRACTION_DONE":
      return onMemoryExtractionDone(lesson, state, now, event);
    case "PREPARE_DONE":
      return onPrepareDone(state, now, event);
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
  expectedStageId?: string | undefined;
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

  if (args.forced) {
    if (args.assistantId === undefined || !state.assistants.includes(args.assistantId))
      return denied(state, now, `force-advance by unknown assistant ${String(args.assistantId)}`);
    if (args.expectedStageId !== undefined && args.expectedStageId !== state.currentStageId)
      return denied(state, now, `stale expectedCurrentStageId ${args.expectedStageId} != ${state.currentStageId}`);
  } else {
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
  let nextState: ClassSession = {
    ...state,
    currentStageId: nextId,
    stageStartTime: now,
    global: "active",
    students,
  };
  const trace = mkTrace(
    now,
    args.forced ? "force_advance" : "stage_transition",
    args.forced
      ? { from: state.currentStageId, assistantId: args.assistantId, reason: args.reason }
      : { from: state.currentStageId },
    nextId,
  );
  const commands: EngineCommand[] = [
    { type: "BROADCAST", message: { type: "STAGE_UNLOCK", stageId: nextId } },
    { type: "PERSIST" },
    { type: "TRACE", event: trace },
  ];
  // Birth pre-generation: when the birth_speech stage unlocks, kick off each student's 专属台词
  // (if their memories are already settled) so the on-stage tap→play is instant (contracts-v1.4).
  if (nextId === birthSpeechStage(lesson)?.stageId) {
    for (const id of Object.keys(nextState.students)) {
      const r = maybePrepareBirth(lesson, nextState, id, now);
      nextState = r.state;
      commands.push(...r.commands);
    }
  }
  return { state: nextState, commands };
}

function onStudentComplete(
  lesson: LessonConfig,
  state: ClassSession,
  now: string,
  event: Extract<EngineEvent, { type: "STUDENT_COMPLETE" }>,
): EngineResult {
  if (event.stageId !== state.currentStageId)
    return denied(state, now, `STUDENT_COMPLETE for ${event.stageId}, current is ${state.currentStageId}`);
  const stage = stageById(lesson, state.currentStageId);
  if (!stage) return denied(state, now, `unknown stage ${state.currentStageId}`);
  const payloadErr = payloadError(lesson, stage, event.payload);
  if (payloadErr) return denied(state, now, payloadErr);
  return updateStudent(state, event.studentId, now, (s) =>
    applyCompletion(s, event.stageId, event.payload),
  );
}

function onInteractionDone(
  state: ClassSession,
  now: string,
  event: Extract<EngineEvent, { type: "INTERACTION_DONE" }>,
): EngineResult {
  if (event.stageId !== state.currentStageId)
    return denied(state, now, `INTERACTION_DONE for ${event.stageId}, current is ${state.currentStageId}`);
  const s = state.students[event.studentId];
  if (!s) return denied(state, now, `unknown student ${event.studentId}`);
  // only a PENDING interaction for THIS stage counts — late/duplicate/stale completions dropped
  const p = s.pending[event.interactionId];
  if (!p || p.stageId !== event.stageId) {
    return {
      state,
      commands: [
        { type: "TRACE", event: mkTrace(now, "interaction", { dropped: true, reason: "not_pending_or_stale", interactionId: event.interactionId, studentId: event.studentId }) },
      ],
    };
  }
  const { [event.interactionId]: _cleared, ...pending } = s.pending;
  void _cleared;
  const nextS: StudentRuntimeState = {
    ...s,
    pending,
    interactionCounts: { ...s.interactionCounts, [event.stageId]: (s.interactionCounts[event.stageId] ?? 0) + 1 },
    completedInteractionIds: [...s.completedInteractionIds, event.interactionId],
  };
  const nextState: ClassSession = { ...state, students: { ...state.students, [event.studentId]: nextS } };
  const commands: EngineCommand[] = [{ type: "PERSIST" }];
  if (event.degraded) {
    // operator-visible degradation (AGENTS.md): the child saw a graceful fallback
    commands.push({ type: "TRACE", event: mkTrace(now, "fallback", { degraded: true, interactionId: event.interactionId, studentId: event.studentId }, event.stageId) });
  }
  return { state: nextState, commands };
}

/** Outputs the given stage is allowed to write (union of its variants' writesOutputs). */
function stageWritableOutputs(stage: StageConfig): Set<string> {
  const out = new Set<string>();
  for (const v of stage.variants ?? []) for (const o of v.writesOutputs ?? []) out.add(o);
  return out;
}

/** Validate a completion payload against the CURRENT stage + lesson declarations. */
function payloadError(lesson: LessonConfig, stage: StageConfig, payload: StageCompletePayload): string | null {
  switch (payload.kind) {
    case "selection":
      // must be globally declared AND writable by this stage (stops e.g. intro writing avatarUrl)
      if (!lesson.declaredOutputs.includes(payload.output))
        return `output "${payload.output}" not in declaredOutputs`;
      return stageWritableOutputs(stage).has(payload.output)
        ? null
        : `output "${payload.output}" not writable by stage "${stage.stageId}"`;
    case "variantChoice":
      return (stage.variants ?? []).some((v) => v.id === payload.variantId)
        ? null
        : `variant "${payload.variantId}" not in stage "${stage.stageId}"`;
    case "done":
      return null;
    default: {
      const _exhaustive: never = payload;
      return _exhaustive;
    }
  }
}

/** Illegal/blocked event: state unchanged, logged for operators, never shown to a child. */
function denied(state: ClassSession, now: string, reason: string): EngineResult {
  return {
    state,
    commands: [
      { type: "TRACE", event: mkTrace(now, "stage_transition", { denied: true, code: "STAGE_TRANSITION_DENIED", reason }, state.currentStageId) },
    ],
  };
}

function updateStudent(
  state: ClassSession,
  studentId: string,
  now: string,
  fn: (s: StudentRuntimeState) => StudentRuntimeState,
): EngineResult {
  const s = state.students[studentId];
  if (!s) return denied(state, now, `unknown student ${studentId}`);
  const nextState: ClassSession = { ...state, students: { ...state.students, [studentId]: fn(s) } };
  return { state: nextState, commands: [{ type: "PERSIST" }] };
}

function applyCompletion(s: StudentRuntimeState, stageId: StageId, payload: StageCompletePayload): StudentRuntimeState {
  const base: StudentRuntimeState = { ...s, stageStatus: { ...s.stageStatus, [stageId]: "completed" } };
  switch (payload.kind) {
    case "selection":
      return { ...base, outputs: { ...base.outputs, [payload.output]: payload.value } };
    case "variantChoice":
      return { ...base, selectedVariant: { ...base.selectedVariant, [stageId]: payload.variantId } };
    case "done":
      return base;
    default: {
      const _exhaustive: never = payload;
      return _exhaustive;
    }
  }
}

/** Accept an interaction input: record it pending (idempotent/stage-checked) + emit CALL_INTERACTION. */
function onInteract(
  lesson: LessonConfig,
  state: ClassSession,
  now: string,
  event: Extract<EngineEvent, { type: "INTERACT" }>,
): EngineResult {
  // playPrepared is a replay of a stored output, NOT an AI call — handled out-of-band by the
  // controller. It must never reach the reducer's interaction path (no pending, no CALL_INTERACTION).
  if (event.input.kind === "playPrepared")
    return denied(state, now, `playPrepared must be handled out-of-band, not as an INTERACT event`);
  if (event.stageId !== state.currentStageId)
    return denied(state, now, `INTERACT for ${event.stageId}, current is ${state.currentStageId}`);
  if (!stageById(lesson, state.currentStageId)) return denied(state, now, `unknown stage ${state.currentStageId}`);
  const s = state.students[event.studentId];
  if (!s) return denied(state, now, `unknown student ${event.studentId}`);
  // idempotent: a duplicate interactionId (in-flight or already completed) is dropped — no
  // second pending, no second gateway call
  if (s.pending[event.interactionId] || s.completedInteractionIds.includes(event.interactionId)) {
    return { state, commands: [{ type: "TRACE", event: mkTrace(now, "interaction", { dropped: true, reason: "duplicate_interaction", interactionId: event.interactionId, studentId: event.studentId }) }] };
  }
  // talent voice/answer inputs feed an invisible memory extraction; seed pendingMemory so birth
  // pre-generation waits for the transcript to be mined (contracts-v1.4).
  const willExtract = wantsMemoryExtraction(lesson, event.stageId, event.input);
  const nextS: StudentRuntimeState = {
    ...s,
    pending: { ...s.pending, [event.interactionId]: { stageId: event.stageId } },
    pendingMemory: willExtract ? [...s.pendingMemory, event.interactionId] : s.pendingMemory,
  };
  const nextState: ClassSession = { ...state, students: { ...state.students, [event.studentId]: nextS } };
  const call: EngineCommand =
    event.variantId !== undefined
      ? { type: "CALL_INTERACTION", studentId: event.studentId, stageId: event.stageId, interactionId: event.interactionId, variantId: event.variantId, input: event.input }
      : { type: "CALL_INTERACTION", studentId: event.studentId, stageId: event.stageId, interactionId: event.interactionId, input: event.input };
  return { state: nextState, commands: [call, { type: "PERSIST" }] };
}

// --- contracts-v1.4: memory extraction + birth pre-generation (capability-driven, no stage ids) ---

/** The stage whose interaction pre-generates an output (Lesson 1: birth's `birth_speech`). */
function birthSpeechStage(lesson: LessonConfig): StageConfig | undefined {
  return lesson.stages.find((st) => st.interaction?.type === "birth_speech");
}

/** True when this talent input should be mined for a memory (audio inputs on a memoryExtraction stage). */
function wantsMemoryExtraction(lesson: LessonConfig, stageId: StageId, input: InteractionInput): boolean {
  const i = stageById(lesson, stageId)?.interaction;
  if (!i || i.type !== "multimodal_talent" || !i.memoryExtraction) return false;
  return input.kind === "voice" || input.kind === "talentAnswer";
}

/** Deterministic, one-per-student handle for a stage's prepared output (so re-entry is idempotent). */
function preparedIdFor(studentId: string, stageId: StageId): string {
  return `prepared:${stageId}:${studentId}`;
}

/** Drain a settled memory extraction; write the memory if valid; then try to start birth pre-gen. */
function onMemoryExtractionDone(
  lesson: LessonConfig,
  state: ClassSession,
  now: string,
  event: Extract<EngineEvent, { type: "MEMORY_EXTRACTION_DONE" }>,
): EngineResult {
  const s = state.students[event.studentId];
  if (!s) return denied(state, now, `unknown student ${event.studentId}`);
  // idempotent: only a real, still-outstanding extraction counts. A duplicate/late event for an id
  // already drained is a no-op — it must NOT (re)write memory or re-trigger pre-generation.
  if (!s.pendingMemory.includes(event.interactionId)) {
    return { state, commands: [{ type: "TRACE", event: mkTrace(now, "interaction", { dropped: true, reason: "duplicate_or_late_memory", interactionId: event.interactionId, studentId: event.studentId }, event.stageId) }] };
  }
  const pendingMemory = s.pendingMemory.filter((id) => id !== event.interactionId);
  let memories = s.memories;
  const traces: EngineCommand[] = [];
  if (event.memory) {
    const fromTalent = stageById(lesson, event.stageId)?.interaction?.type === "multimodal_talent";
    if (fromTalent && lesson.declaredMemoryKeys.includes(event.memory.key)) {
      memories = { ...s.memories, [event.memory.key]: event.memory.value };
    } else {
      traces.push({ type: "TRACE", event: mkTrace(now, "interaction", { dropped: true, reason: "invalid_memory", key: event.memory.key, studentId: event.studentId }, event.stageId) });
    }
  }
  let nextState: ClassSession = { ...state, students: { ...state.students, [event.studentId]: { ...s, pendingMemory, memories } } };
  const prep = maybePrepareBirth(lesson, nextState, event.studentId, now);
  nextState = prep.state;
  return { state: nextState, commands: [{ type: "PERSIST" }, ...traces, ...prep.commands] };
}

/** Fill the reducer-minted prepared placeholder once generation completes (idempotent + ready-gated). */
function onPrepareDone(
  state: ClassSession,
  now: string,
  event: Extract<EngineEvent, { type: "PREPARE_DONE" }>,
): EngineResult {
  const s = state.students[event.studentId];
  if (!s) return denied(state, now, `unknown student ${event.studentId}`);
  const existing = s.prepared[event.preparedId];
  if (!existing || existing.ready) {
    // no placeholder (stale) or already filled (duplicate) — drop, never overwrite a ready output
    return { state, commands: [{ type: "TRACE", event: mkTrace(now, "interaction", { dropped: true, reason: "stale_or_duplicate_prepare", preparedId: event.preparedId, studentId: event.studentId }, event.stageId) }] };
  }
  // never mark an EMPTY output ready — a ready entry must be playable, else playPrepared would
  // replay a blank. The runner always supplies a friendly fallback line, so this is a backstop.
  const isEmpty = !event.output.text && !event.output.audioUrl && !(event.output.imageUrls && event.output.imageUrls.length);
  if (isEmpty) {
    return { state, commands: [{ type: "TRACE", event: mkTrace(now, "fallback", { dropped: true, reason: "empty_prepared_output_rejected", preparedId: event.preparedId, studentId: event.studentId }, event.stageId) }] };
  }
  const filled: PreparedOutput = { ...existing, ready: true, output: event.output, outputKind: event.outputKind, degraded: event.degraded, preparedAt: now };
  const nextS: StudentRuntimeState = { ...s, prepared: { ...s.prepared, [event.preparedId]: filled } };
  const nextState: ClassSession = { ...state, students: { ...state.students, [event.studentId]: nextS } };
  const commands: EngineCommand[] = [{ type: "PERSIST" }];
  if (event.degraded) commands.push({ type: "TRACE", event: mkTrace(now, "fallback", { degraded: true, reason: "prepared_fallback", preparedId: event.preparedId, studentId: event.studentId }, event.stageId) });
  return { state: nextState, commands };
}

/**
 * Start birth pre-generation for ONE student if it's due and not already started. Idempotent: a
 * deterministic `preparedId` + the "already prepared" guard ⇒ at most one CALL_PREPARE per student.
 * Gate: the birth stage is current AND that student's memories are settled (`pendingMemory` empty).
 *
 * `pendingMemory` empty SUBSUMES the design's "no pending talent interaction" clause: only audio
 * talent inputs (voice/talentAnswer) feed the speech, and every one of those is tracked in
 * `pendingMemory` (seeded at INTERACT, drained at MEMORY_EXTRACTION_DONE — even when the reply went
 * stale). A still-pending `talentOption` contributes no memory, so it cannot change the speech;
 * gating on it would also strand pre-gen (the controller clears a stale interaction without a
 * reducer event). So this gate is both correct and simpler. Re-checked at birth-unlock and on
 * every MEMORY_EXTRACTION_DONE drain.
 */
function maybePrepareBirth(
  lesson: LessonConfig,
  state: ClassSession,
  studentId: string,
  now: string,
): { state: ClassSession; commands: EngineCommand[] } {
  const birth = birthSpeechStage(lesson);
  const s = state.students[studentId];
  if (!birth || !s) return { state, commands: [] };
  const interaction = birth.interaction;
  if (!interaction || interaction.type !== "birth_speech") return { state, commands: [] };
  if (state.currentStageId !== birth.stageId) return { state, commands: [] }; // birth not unlocked yet
  if (s.pendingMemory.length > 0) return { state, commands: [] }; // memories not settled
  const preparedId = preparedIdFor(studentId, birth.stageId);
  if (s.prepared[preparedId]) return { state, commands: [] }; // already minted (placeholder or ready)

  const placeholder: PreparedOutput = { stageId: birth.stageId, outputKind: interaction.outputKind, ready: false, output: {}, degraded: false, preparedAt: now };
  const nextS: StudentRuntimeState = { ...s, prepared: { ...s.prepared, [preparedId]: placeholder } };
  const nextState: ClassSession = { ...state, students: { ...state.students, [studentId]: nextS } };
  const cmd: EngineCommand = { type: "CALL_PREPARE", studentId, stageId: birth.stageId, preparedId, promptVersion: interaction.promptTemplate, outputKind: interaction.outputKind };
  return { state: nextState, commands: [cmd] };
}

function mkTrace(now: string, kind: TraceEvent["kind"], payload: Record<string, unknown>, stageId?: StageId): TraceEvent {
  return stageId !== undefined ? { at: now, kind, stageId, payload } : { at: now, kind, payload };
}
