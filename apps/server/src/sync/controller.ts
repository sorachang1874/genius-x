/**
 * ClassroomController — the transport-agnostic brain. Maps `ClientMessage` → `EngineEvent`,
 * runs the reducer over the authoritative `ClassSession` inside an ATOMIC store.update, then
 * emits effects AFTER the new state is durable (persist-before-broadcast). `CALL_INTERACTION`
 * is dispatched to an interaction runner OUTSIDE the mutex (it calls the AI gateway, delivers
 * AI_OUTPUT, then feeds INTERACTION_DONE back) — so the slow AI never holds the session lock.
 * Every loaded session is validated against the lesson before use (fail closed).
 */
import type {
  LessonConfig,
  ClassSession,
  StudentRuntimeState,
  ClientMessage,
  ServerMessage,
  ClientAiOutput,
  EngineEvent,
  EngineCommand,
  TraceEvent,
} from "@genius-x/contracts";
import type { AiGateway } from "@genius-x/ai-gateway";
import type { Reducer } from "../engine";
import { stageById } from "../engine/nextStage";
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
  return { stageStatus: {}, interactionCounts: {}, completedInteractionIds: [], selectedVariant: {}, pending: {}, outputs: {} };
}

/** Wire → engine. Returns null for messages handled out-of-band (HELLO/REQUEST_PROJECTION). */
export function mapToEvent(msg: ClientMessage): EngineEvent | null {
  switch (msg.type) {
    case "ASSISTANT_UNLOCK":
      return { type: "UNLOCK", role: "assistant", stageId: msg.stageId, assistantId: msg.assistantId };
    case "TEACHER_UNLOCK":
      return { type: "UNLOCK", role: "teacher", stageId: msg.stageId };
    case "FORCE_ADVANCE": {
      const e: Extract<EngineEvent, { type: "FORCE_ADVANCE" }> = { type: "FORCE_ADVANCE", stageId: msg.stageId, assistantId: msg.assistantId };
      if (msg.reason !== undefined) e.reason = msg.reason;
      if (msg.expectedCurrentStageId !== undefined) e.expectedCurrentStageId = msg.expectedCurrentStageId;
      return e;
    }
    case "INTERACT":
      return msg.variantId !== undefined
        ? { type: "INTERACT", studentId: msg.studentId, stageId: msg.stageId, interactionId: msg.interactionId, variantId: msg.variantId, input: msg.input }
        : { type: "INTERACT", studentId: msg.studentId, stageId: msg.stageId, interactionId: msg.interactionId, input: msg.input };
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

interface Effects {
  broadcasts: ServerMessage[];
  traces: TraceEvent[];
  calls: Extract<EngineCommand, { type: "CALL_INTERACTION" }>[];
}

export class ClassroomController {
  constructor(
    private readonly lesson: LessonConfig,
    private readonly reducer: Reducer,
    private readonly store: SessionStore,
    private readonly emit: Emitter,
    private readonly trace: TraceSink,
    private readonly clock: Clock,
    private readonly gateway: AiGateway,
  ) {}

  async onMessage(sessionId: string, msg: ClientMessage): Promise<void> {
    if (msg.type === "HELLO") return this.resume(sessionId, msg.studentId);
    if (msg.type === "REQUEST_PROJECTION") return; // teacher-screen projection wiring is a later step
    const event = mapToEvent(msg);
    if (event) await this.applyEvent(sessionId, event);
  }

  /** Run one engine event through the atomic store update, then emit effects + dispatch interactions. */
  private async applyEvent(sessionId: string, event: EngineEvent): Promise<void> {
    const effects = await this.store.update<Effects>(sessionId, async (session) => {
      const guard = this.guardSession(session, sessionId);
      if (guard) return { out: { broadcasts: [], traces: [guard], calls: [] } };
      const result = this.reducer(session as ClassSession, event, this.clock.now());
      const persist = result.commands.some((c) => c.type === "PERSIST");
      const broadcasts: ServerMessage[] = [];
      const traces: TraceEvent[] = [];
      const calls: Effects["calls"] = [];
      for (const c of result.commands) {
        if (c.type === "BROADCAST") broadcasts.push(c.message);
        else if (c.type === "TRACE") traces.push(c.event);
        else if (c.type === "CALL_INTERACTION") calls.push(c);
      }
      return { next: persist ? result.state : undefined, out: { broadcasts, traces, calls } };
    });
    for (const t of effects.traces) this.trace.record(t);
    for (const m of effects.broadcasts) this.emit.toSession(sessionId, m);
    // run interactions OUTSIDE the mutex (they call the slow gateway, then feed INTERACTION_DONE back)
    for (const call of effects.calls)
      void this.runInteraction(sessionId, call).catch((err: unknown) =>
        this.trace.record(this.mkTrace("interaction", { reason: "run_interaction_failed", error: String(err), sessionId, interactionId: call.interactionId })),
      );
  }

  /** Resolve a CALL_INTERACTION: call the gateway, then ATOMICALLY (only if still pending + current
   *  stage) complete the interaction AND deliver AI_OUTPUT — so a stale/advanced class never gets it. */
  private async runInteraction(sessionId: string, cmd: Extract<EngineCommand, { type: "CALL_INTERACTION" }>): Promise<void> {
    const { studentId, stageId, interactionId, input } = cmd;
    let output: ClientAiOutput;
    let degraded: boolean;
    try {
      ({ output, degraded } = await this.callGateway(stageId, input));
    } catch (err) {
      // gateway methods shouldn't throw, but be defensive — degrade + still complete
      this.trace.record(this.mkTrace("fallback", { reason: "gateway_threw", error: String(err), interactionId, studentId }));
      output = {};
      degraded = true;
    }

    const accepted = await this.store.update<{ ok: boolean; traces: TraceEvent[] }>(sessionId, async (session) => {
      const guard = this.guardSession(session, sessionId);
      if (guard) return { out: { ok: false, traces: [guard] } };
      const s = session as ClassSession;
      const student = s.students[studentId];
      const valid = !!student && !!student.pending[interactionId] && s.currentStageId === stageId;
      if (!valid) {
        return { out: { ok: false, traces: [this.mkTrace("interaction", { dropped: true, reason: "stale_interaction", interactionId, studentId })] } };
      }
      const result = this.reducer(s, { type: "INTERACTION_DONE", studentId, stageId, interactionId, degraded }, this.clock.now());
      const persist = result.commands.some((c) => c.type === "PERSIST");
      const traces = result.commands.filter((c): c is Extract<EngineCommand, { type: "TRACE" }> => c.type === "TRACE").map((c) => c.event);
      return { next: persist ? result.state : undefined, out: { ok: persist, traces } };
    });
    for (const t of accepted.traces) this.trace.record(t);
    if (accepted.ok) this.emit.toStudent(sessionId, studentId, { type: "AI_OUTPUT", studentId, stageId, interactionId, output });
  }

  /** Map an interaction input to gateway calls → a child-renderable output + degraded flag. */
  private async callGateway(stageId: string, input: Extract<EngineCommand, { type: "CALL_INTERACTION" }>["input"]): Promise<{ output: ClientAiOutput; degraded: boolean }> {
    const promptVersion = this.promptFor(stageId);
    let degraded = false;
    const mark = (m: { degraded: boolean }): void => { if (m.degraded) degraded = true; };
    switch (input.kind) {
      case "voice":
      case "talentAnswer": {
        const asr = await this.gateway.asr({ audioRef: input.audioRef }); mark(asr.meta);
        const llm = await this.gateway.llm({ promptVersion, input: asr.transcript }); mark(llm.meta);
        const tts = await this.gateway.tts({ text: llm.text }); mark(tts.meta);
        return { output: { text: llm.text, audioUrl: tts.audioUrl }, degraded };
      }
      case "talentOption": {
        const llm = await this.gateway.llm({ promptVersion, input: input.option }); mark(llm.meta);
        const tts = await this.gateway.tts({ text: llm.text }); mark(tts.meta);
        return { output: { text: llm.text, audioUrl: tts.audioUrl }, degraded };
      }
      case "doodle": {
        const img = await this.gateway.imageGen({ kind: "img2img", source: input.doodleRef, count: 3 }); mark(img.meta);
        return { output: { imageUrls: img.imageUrls }, degraded };
      }
      case "answers": {
        const img = await this.gateway.imageGen({ kind: "text2img", source: JSON.stringify(input.answersByQuestionId), count: 3 }); mark(img.meta);
        return { output: { imageUrls: img.imageUrls }, degraded };
      }
      default: {
        const _exhaustive: never = input;
        return _exhaustive;
      }
    }
  }

  /** The prompt template a stage's interaction uses (falls back to a generic id). */
  private promptFor(stageId: string): string {
    const stage = stageById(this.lesson, stageId);
    const i = stage?.interaction ?? stage?.variants?.[0]?.interaction;
    return i && "promptTemplate" in i ? i.promptTemplate : "generic_v1";
  }

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
