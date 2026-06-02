/**
 * ClassroomController — the transport-agnostic brain. Maps `ClientMessage` → `EngineEvent`,
 * runs the reducer over the authoritative `ClassSession` inside an ATOMIC store.update (no
 * lost writes), then emits effects AFTER the new state is durable (persist-before-broadcast).
 * Every loaded session is validated against the lesson before use (fail closed). Socket.IO +
 * Fastify are thin layers over this (sync/socket.ts, http.ts), so the logic is unit-testable.
 */
import type {
  LessonConfig,
  ClassSession,
  StudentRuntimeState,
  ClientMessage,
  ServerMessage,
  EngineEvent,
  TraceEvent,
} from "@genius-x/contracts";
import type { Reducer } from "../engine";
import type { SessionStore } from "../session/store";
import { validateClassSessionForLesson } from "../session/validateSession";

export interface Emitter {
  toSession(sessionId: string, msg: ServerMessage): void;
  toStudent(sessionId: string, studentId: string, msg: ServerMessage): void;
}
export interface TraceSink {
  record(event: TraceEvent): void;
}
export interface Clock {
  now(): string;
}

export function freshStudentState(): StudentRuntimeState {
  return { stageStatus: {}, interactionCounts: {}, completedInteractionIds: [], selectedVariant: {}, outputs: {} };
}

/** Wire → engine. Returns null for messages handled out-of-band (HELLO/REQUEST_PROJECTION). */
export function mapToEvent(msg: ClientMessage): EngineEvent | null {
  switch (msg.type) {
    case "ASSISTANT_UNLOCK":
      return { type: "UNLOCK", role: "assistant", stageId: msg.stageId, assistantId: msg.assistantId };
    case "TEACHER_UNLOCK":
      return { type: "UNLOCK", role: "teacher", stageId: msg.stageId };
    case "FORCE_ADVANCE":
      return msg.reason !== undefined
        ? { type: "FORCE_ADVANCE", stageId: msg.stageId, assistantId: msg.assistantId, reason: msg.reason }
        : { type: "FORCE_ADVANCE", stageId: msg.stageId, assistantId: msg.assistantId };
    case "STAGE_COMPLETE":
      return { type: "STUDENT_COMPLETE", studentId: msg.studentId, stageId: msg.stageId, payload: msg.payload };
    case "HELLO":
    case "REQUEST_PROJECTION":
      return null;
    default: {
      const _exhaustive: never = msg;
      return _exhaustive;
    }
  }
}

/** What an atomic update produced, to emit AFTER the state is durable. */
interface Effects {
  broadcasts: ServerMessage[];
  traces: TraceEvent[];
}

export class ClassroomController {
  constructor(
    private readonly lesson: LessonConfig,
    private readonly reducer: Reducer,
    private readonly store: SessionStore,
    private readonly emit: Emitter,
    private readonly trace: TraceSink,
    private readonly clock: Clock,
  ) {}

  async onMessage(sessionId: string, msg: ClientMessage): Promise<void> {
    if (msg.type === "HELLO") return this.resume(sessionId, msg.studentId);
    if (msg.type === "REQUEST_PROJECTION") return;

    const event = mapToEvent(msg);
    if (!event) return;
    const expected = msg.type === "FORCE_ADVANCE" ? msg.expectedCurrentStageId : undefined;

    const effects = await this.store.update<Effects>(sessionId, async (session) => {
      const guard = this.guardSession(session, sessionId);
      if (guard) return { out: { broadcasts: [], traces: [guard] } };
      const s = session as ClassSession;
      if (expected !== undefined && expected !== s.currentStageId) {
        return { out: { broadcasts: [], traces: [this.mkTrace("stage_transition", { denied: true, reason: "stale expectedCurrentStageId", expected, actual: s.currentStageId })] } };
      }
      const result = this.reducer(s, event, this.clock.now());
      const persist = result.commands.some((c) => c.type === "PERSIST");
      const broadcasts: ServerMessage[] = [];
      const traces: TraceEvent[] = [];
      for (const c of result.commands) {
        if (c.type === "BROADCAST") broadcasts.push(c.message);
        else if (c.type === "TRACE") traces.push(c.event);
        // PERSIST handled via `next`; CALL_INTERACTION is an M3 hook (no-op)
      }
      return { next: persist ? result.state : undefined, out: { broadcasts, traces } };
    });

    // emit AFTER the new state is durable
    for (const t of effects.traces) this.trace.record(t);
    for (const m of effects.broadcasts) this.emit.toSession(sessionId, m);
  }

  /** Reconnect/resume: send the student the full authoritative state to reconcile to. */
  async resume(sessionId: string, studentId: string): Promise<void> {
    const result = await this.store.update<{ msg?: ServerMessage; trace?: TraceEvent }>(sessionId, async (session) => {
      const guard = this.guardSession(session, sessionId);
      if (guard) return { out: { trace: guard } };
      const s = session as ClassSession;
      let you = s.students[studentId];
      let next: ClassSession | undefined;
      if (!you) {
        you = freshStudentState();
        s.students[studentId] = you;
        next = s;
      }
      const msg: ServerMessage = {
        type: "RESUME_STATE",
        currentStageId: s.currentStageId,
        global: s.global,
        lessonConfigVersion: s.lessonConfigVersion,
        you,
      };
      return { next, out: { msg } };
    });
    if (result.trace) this.trace.record(result.trace);
    if (result.msg) this.emit.toStudent(sessionId, studentId, result.msg);
  }

  /** Validate a loaded session against the lesson; returns a deny-trace if it must fail closed. */
  private guardSession(session: ClassSession | null, sessionId: string): TraceEvent | null {
    if (!session) return this.mkTrace("stage_transition", { denied: true, reason: "unknown session", sessionId });
    const errors = validateClassSessionForLesson(session, this.lesson);
    if (errors.length > 0) return this.mkTrace("stage_transition", { denied: true, reason: "invalid session", errors, sessionId });
    return null;
  }

  private mkTrace(kind: TraceEvent["kind"], payload: Record<string, unknown>): TraceEvent {
    return { at: this.clock.now(), kind, payload };
  }
}
