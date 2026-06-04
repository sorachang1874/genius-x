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
  return { stageStatus: {}, interactionCounts: {}, completedInteractionIds: [], selectedVariant: {}, pending: {}, outputs: {}, memories: {}, pendingMemory: [], prepared: {} };
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
  prepares: Extract<EngineCommand, { type: "CALL_PREPARE" }>[];
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
    if (msg.type === "REQUEST_PROJECTION") return this.requestProjection(sessionId, msg);
    // playPrepared replays a stored output — handled out-of-band (no AI call, no reducer interaction).
    if (msg.type === "INTERACT" && msg.input.kind === "playPrepared")
      return this.playPrepared(sessionId, msg.studentId, msg.stageId, msg.input.preparedId);
    const event = mapToEvent(msg);
    if (event) await this.applyEvent(sessionId, event);
  }

  /** Run one engine event through the atomic store update, then emit effects + dispatch interactions. */
  private async applyEvent(sessionId: string, event: EngineEvent): Promise<void> {
    const effects = await this.store.update<Effects>(sessionId, async (session) => {
      const guard = this.guardSession(session, sessionId);
      if (guard) return { out: { broadcasts: [], traces: [guard], calls: [], prepares: [] } };
      const result = this.reducer(session as ClassSession, event, this.clock.now());
      const persist = result.commands.some((c) => c.type === "PERSIST");
      const broadcasts: ServerMessage[] = [];
      const traces: TraceEvent[] = [];
      const calls: Effects["calls"] = [];
      const prepares: Effects["prepares"] = [];
      for (const c of result.commands) {
        if (c.type === "BROADCAST") broadcasts.push(c.message);
        else if (c.type === "TRACE") traces.push(c.event);
        else if (c.type === "CALL_INTERACTION") calls.push(c);
        else if (c.type === "CALL_PREPARE") prepares.push(c);
      }
      return { next: persist ? result.state : undefined, out: { broadcasts, traces, calls, prepares } };
    });
    for (const t of effects.traces) this.trace.record(t);
    for (const m of effects.broadcasts) this.emit.toSession(sessionId, m);
    // run interactions OUTSIDE the mutex (they call the slow gateway, then feed INTERACTION_DONE back)
    for (const call of effects.calls)
      void this.runInteraction(sessionId, call).catch((err: unknown) =>
        this.trace.record(this.mkTrace("interaction", { reason: "run_interaction_failed", error: String(err), sessionId, interactionId: call.interactionId })),
      );
    // birth pre-generation, also outside the mutex (slow gateway → PREPARE_DONE → AI_READY)
    for (const prep of effects.prepares)
      void this.runPrepare(sessionId, prep).catch((err: unknown) =>
        this.trace.record(this.mkTrace("interaction", { reason: "run_prepare_failed", error: String(err), sessionId, preparedId: prep.preparedId })),
      );
  }

  /** Resolve a CALL_INTERACTION: call the gateway, then ATOMICALLY (only if still pending + current
   *  stage) complete the interaction AND deliver AI_OUTPUT — so a stale/advanced class never gets it. */
  private async runInteraction(sessionId: string, cmd: Extract<EngineCommand, { type: "CALL_INTERACTION" }>): Promise<void> {
    const { studentId, stageId, interactionId, input } = cmd;
    let output: ClientAiOutput;
    let degraded: boolean;
    let transcript: string | undefined;
    try {
      ({ output, degraded, transcript } = await this.callGateway(stageId, input));
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
        const trace = this.mkTrace("interaction", { dropped: true, reason: "stale_interaction", interactionId, studentId });
        // clear the now-stale pending entry so it doesn't leak
        if (student && student.pending[interactionId]) {
          const { [interactionId]: _stale, ...pending } = student.pending;
          void _stale;
          const cleared: ClassSession = { ...s, students: { ...s.students, [studentId]: { ...student, pending } } };
          return { next: cleared, out: { ok: false, traces: [trace] } };
        }
        return { out: { ok: false, traces: [trace] } };
      }
      const result = this.reducer(s, { type: "INTERACTION_DONE", studentId, stageId, interactionId, degraded }, this.clock.now());
      const persist = result.commands.some((c) => c.type === "PERSIST");
      const traces = result.commands.filter((c): c is Extract<EngineCommand, { type: "TRACE" }> => c.type === "TRACE").map((c) => c.event);
      return { next: persist ? result.state : undefined, out: { ok: persist, traces } };
    });
    for (const t of accepted.traces) this.trace.record(t);
    if (accepted.ok) this.emit.toStudent(sessionId, studentId, { type: "AI_OUTPUT", studentId, stageId, interactionId, output });

    // Memory extraction (contracts-v1.4): for an extracting talent input, reuse the ASR transcript
    // to mine one memory. Runs AFTER the reply (never blocks it) and ALWAYS feeds
    // MEMORY_EXTRACTION_DONE — even if the reply was stale — so `pendingMemory` drains and birth
    // pre-generation can proceed.
    if (this.wantsMemory(stageId, input)) await this.runMemoryExtraction(sessionId, studentId, stageId, interactionId, transcript);
  }

  /** True when the reducer seeded `pendingMemory` for this input (must match the reducer's rule). */
  private wantsMemory(stageId: string, input: Extract<EngineCommand, { type: "CALL_INTERACTION" }>["input"]): boolean {
    const i = stageById(this.lesson, stageId)?.interaction;
    if (!i || i.type !== "multimodal_talent" || !i.memoryExtraction) return false;
    return input.kind === "voice" || input.kind === "talentAnswer";
  }

  /** Mine one memory from the transcript, then drain it (with/without a memory) via the reducer. */
  private async runMemoryExtraction(sessionId: string, studentId: string, stageId: string, interactionId: string, transcript: string | undefined): Promise<void> {
    let memory: { key: string; value: string } | undefined;
    if (transcript) {
      try {
        const m = await this.gateway.extractMemory({ transcript, allowedKeys: this.lesson.declaredMemoryKeys, promptVersion: "memory_v1", studentId, stageId });
        if (m.key && m.value) memory = { key: m.key, value: m.value };
      } catch (err) {
        this.trace.record(this.mkTrace("interaction", { reason: "extract_memory_threw", error: String(err), interactionId, studentId }));
      }
    }
    await this.applyEvent(sessionId, memory
      ? { type: "MEMORY_EXTRACTION_DONE", studentId, stageId, interactionId, memory }
      : { type: "MEMORY_EXTRACTION_DONE", studentId, stageId, interactionId });
  }

  /** Resolve a CALL_PREPARE: build the speech from the student's settled memories, then ATOMICALLY
   *  fill the prepared placeholder (PREPARE_DONE) and signal AI_READY. */
  private async runPrepare(sessionId: string, cmd: Extract<EngineCommand, { type: "CALL_PREPARE" }>): Promise<void> {
    const { studentId, stageId, preparedId, promptVersion, outputKind } = cmd;
    let output: ClientAiOutput;
    let degraded: boolean;
    try {
      const session = await this.store.load(sessionId);
      const memories = session?.students[studentId]?.memories ?? {};
      const llm = await this.gateway.llm({ promptVersion, input: JSON.stringify(memories) });
      const tts = await this.gateway.tts({ text: llm.text });
      output = { text: llm.text, audioUrl: tts.audioUrl };
      degraded = llm.meta.degraded || tts.meta.degraded;
    } catch (err) {
      this.trace.record(this.mkTrace("fallback", { reason: "prepare_gateway_threw", error: String(err), preparedId, studentId }));
      output = {};
      degraded = true;
    }

    const accepted = await this.store.update<{ ok: boolean; traces: TraceEvent[] }>(sessionId, async (session) => {
      const guard = this.guardSession(session, sessionId);
      if (guard) return { out: { ok: false, traces: [guard] } };
      const result = this.reducer(session as ClassSession, { type: "PREPARE_DONE", studentId, stageId, preparedId, output, outputKind, degraded }, this.clock.now());
      const persist = result.commands.some((c) => c.type === "PERSIST");
      const traces = result.commands.filter((c): c is Extract<EngineCommand, { type: "TRACE" }> => c.type === "TRACE").map((c) => c.event);
      return { next: persist ? result.state : undefined, out: { ok: persist, traces } };
    });
    for (const t of accepted.traces) this.trace.record(t);
    if (accepted.ok) this.emit.toStudent(sessionId, studentId, { type: "AI_READY", studentId, stageId, preparedId, outputKind });
  }

  /** Replay a pre-generated output — ONLY if it's the current stage and the entry is ready. Never
   *  emits an empty output (so AI_READY is a real server gate, not just a UI hint). */
  private async playPrepared(sessionId: string, studentId: string, stageId: string, preparedId: string): Promise<void> {
    const session = await this.store.load(sessionId);
    if (!session) return;
    const prepared = session.students[studentId]?.prepared[preparedId];
    if (session.currentStageId !== stageId || !prepared || !prepared.ready) {
      this.trace.record(this.mkTrace("interaction", { dropped: true, reason: "play_not_ready_or_stale", preparedId, studentId }));
      return;
    }
    this.emit.toStudent(sessionId, studentId, { type: "AI_OUTPUT", studentId, stageId, interactionId: preparedId, output: prepared.output });
  }

  /** Project a child's prepared output to the big screen — control-surface only, ready-gated. */
  private async requestProjection(sessionId: string, msg: Extract<ClientMessage, { type: "REQUEST_PROJECTION" }>): Promise<void> {
    const session = await this.store.load(sessionId);
    if (!session) return;
    const student = session.students[msg.studentId];
    // role: derived from the control-surface id (trusted-classroom MVP; real RBAC = Better Auth).
    const isControlSurface = !!msg.requestedBy && !session.students[msg.requestedBy];
    const ready = student && Object.values(student.prepared).find((p) => p.ready && p.stageId === session.currentStageId);
    if (!isControlSurface || !ready) {
      this.trace.record(this.mkTrace("interaction", { dropped: true, reason: "projection_denied_or_not_ready", studentId: msg.studentId, requestedBy: msg.requestedBy }));
      return;
    }
    this.emit.toSession(sessionId, { type: "PROJECT", studentId: msg.studentId, output: ready.output });
  }

  /** Map an interaction input to gateway calls → a child-renderable output + degraded flag. */
  private async callGateway(stageId: string, input: Extract<EngineCommand, { type: "CALL_INTERACTION" }>["input"]): Promise<{ output: ClientAiOutput; degraded: boolean; transcript?: string }> {
    const promptVersion = this.promptFor(stageId);
    let degraded = false;
    const mark = (m: { degraded: boolean }): void => { if (m.degraded) degraded = true; };
    switch (input.kind) {
      case "voice":
      case "talentAnswer": {
        const asr = await this.gateway.asr({ audioRef: input.audioRef }); mark(asr.meta);
        const llm = await this.gateway.llm({ promptVersion, input: asr.transcript }); mark(llm.meta);
        const tts = await this.gateway.tts({ text: llm.text }); mark(tts.meta);
        return { output: { text: llm.text, audioUrl: tts.audioUrl }, degraded, transcript: asr.transcript };
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
      case "playPrepared":
        // never reached — playPrepared is intercepted in onMessage (replay of a stored output,
        // not an AI call). Defensive: degrade rather than throw.
        return { output: {}, degraded: true };
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
