/**
 * ClassroomController — the transport-agnostic brain. Maps `ClientMessage` → `EngineEvent`,
 * runs the reducer over the authoritative `ClassSession` from the store, and executes the
 * resulting `EngineCommand`s through injected effects (emit/trace/store). Socket.IO + Fastify
 * are thin layers over this (sync/socket.ts, http.ts), so the logic is unit-testable.
 */
import type {
  LessonConfig,
  ClassSession,
  StudentRuntimeState,
  ClientMessage,
  ServerMessage,
  EngineEvent,
  EngineResult,
  TraceEvent,
} from "@genius-x/contracts";
import type { Reducer } from "../engine";
import type { SessionStore } from "../session/store";

export interface Emitter {
  /** Broadcast to everyone in the class/session room. */
  toSession(sessionId: string, msg: ServerMessage): void;
  /** Send directly to one student (e.g. RESUME_STATE). */
  toStudent(sessionId: string, studentId: string, msg: ServerMessage): void;
}

export interface TraceSink {
  record(event: TraceEvent): void;
}

export interface Clock {
  now(): string;
}

export function freshStudentState(): StudentRuntimeState {
  return {
    stageStatus: {},
    interactionCounts: {},
    completedInteractionIds: [],
    selectedVariant: {},
    outputs: {},
  };
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
    if (msg.type === "REQUEST_PROJECTION") return; // projection is a teacher-screen concern (later)

    const event = mapToEvent(msg);
    if (!event) return;
    const session = await this.store.load(sessionId);
    if (!session) {
      this.trace.record({ at: this.clock.now(), kind: "stage_transition", payload: { denied: true, reason: "unknown session", sessionId } });
      return;
    }
    const result = this.reducer(session, event, this.clock.now());
    await this.apply(sessionId, result);
  }

  /** Reconnect/resume: send the student the full authoritative state to reconcile to. */
  async resume(sessionId: string, studentId: string): Promise<void> {
    const session = await this.store.load(sessionId);
    if (!session) return;
    let you = session.students[studentId];
    if (!you) {
      // a student joining via HELLO: register them, persist
      you = freshStudentState();
      session.students[studentId] = you;
      await this.store.save(session);
    }
    this.emit.toStudent(sessionId, studentId, {
      type: "RESUME_STATE",
      currentStageId: session.currentStageId,
      global: session.global,
      lessonConfigVersion: session.lessonConfigVersion,
      you,
    });
  }

  private async apply(sessionId: string, result: EngineResult): Promise<void> {
    for (const c of result.commands) {
      switch (c.type) {
        case "BROADCAST":
          this.emit.toSession(sessionId, c.message);
          break;
        case "PERSIST":
          await this.store.save(result.state);
          break;
        case "TRACE":
          this.trace.record(c.event);
          break;
        case "CALL_INTERACTION":
          // M3 hook: dispatch to the AI gateway. No-op in M1.
          break;
        default: {
          const _exhaustive: never = c;
          void _exhaustive;
        }
      }
    }
  }

  /** Expose the loaded lesson (used by the HTTP join layer). */
  get lessonConfig(): LessonConfig {
    return this.lesson;
  }
}
