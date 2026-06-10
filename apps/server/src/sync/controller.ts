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
  ArtifactType,
  InteractionRecord,
} from "@genius-x/contracts";
import type { AiGateway } from "@genius-x/ai-gateway";
import type { Reducer } from "../engine";
import { stageById } from "../engine/nextStage";
import type { SessionStore } from "../session/store";
import { validateClassSessionForLesson } from "../session/validateSession";
import { IdentityServiceError, type IdentityService } from "../identity/service";
import { WorkspaceServiceError, type WorkspaceService } from "../workspace/service";
import type { LessonShareMinter } from "../share/service";

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
  /** Set when this event transitioned the class INTO the final stage (lesson complete). */
  completed?: { lessonId: string; students: Record<string, StudentRuntimeState> };
  /** Stage completions that produce a lesson-declared artifact (Phase 2 workspace works). */
  artifacts?: { studentId: string; stageId: string; type: ArtifactType; you: StudentRuntimeState }[];
}

/** Friendly preset台词 if birth pre-generation degrades to nothing — the child always hears something
 *  (PRD §0). Child-safe: no AI/Prompt/LLM wording. Replaced by real content when providers land (DF-M4-1). */
const BIRTH_FALLBACK_LINE = "我是你的好朋友呀，今天认识你真高兴，我们以后一起玩！";

export class ClassroomController {
  constructor(
    private readonly lesson: LessonConfig,
    private readonly reducer: Reducer,
    private readonly store: SessionStore,
    private readonly emit: Emitter,
    private readonly trace: TraceSink,
    private readonly clock: Clock,
    private readonly gateway: AiGateway,
    /**
     * Phase 1 (Step 6): persistent profile write-back at lesson end. OPTIONAL — identity
     * down or absent NEVER touches the running classroom (write-back is fire-and-forget;
     * skips/failures are operator-visible traces only).
     */
    private readonly identity?: IdentityService,
    /**
     * Phase 2: per-stage workspace writes (works/interactions/memories). OPTIONAL — absence
     * is a deployment state (one skip trace per controller), never a silent fallback;
     * failures are operator traces and NEVER touch the classroom.
     */
    private readonly workspace?: WorkspaceService,
    /**
     * Phase 3: parent share link minted at lesson end (fire-and-forget; mint failure =
     * operator trace, sink failure swallowed inside the minter — lesson never affected).
     */
    private readonly shareMinter?: LessonShareMinter,
  ) {}

  private readonly workspaceSkipTraced = new Set<string>();

  async onMessage(sessionId: string, msg: ClientMessage): Promise<void> {
    if (msg.type === "HELLO") {
      if (msg.studentId) {
        return this.resume(sessionId, msg.studentId);
      } else if (msg.assistantId) {
        return this.resumeAssistant(sessionId, msg.assistantId);
      }
      return;
    }
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
      const before = session as ClassSession;
      const result = this.reducer(before, event, this.clock.now());
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
      // Lesson complete = the class transitioned INTO the final stage (incl. via
      // FORCE_ADVANCE — an operator decision still ends the lesson). Captured inside the
      // mutex for a consistent snapshot; written back OUTSIDE it (fire-and-forget).
      const finalStageId = this.lesson.stages[this.lesson.stages.length - 1]!.stageId;
      const completed =
        persist && before.currentStageId !== finalStageId && result.state.currentStageId === finalStageId
          ? { lessonId: before.lessonId, students: result.state.students }
          : undefined;
      // Phase 2: a student COMPLETING a stage that declares an artifact (stage.output)
      // produces a workspace Work — captured here (consistent snapshot), written outside.
      const artifacts: Effects["artifacts"] = [];
      if (persist && event.type === "STUDENT_COMPLETE") {
        const stage = stageById(this.lesson, event.stageId);
        const wasDone = before.students[event.studentId]?.stageStatus[event.stageId] === "completed";
        const isDone = result.state.students[event.studentId]?.stageStatus[event.stageId] === "completed";
        if (stage?.output && !wasDone && isDone) {
          artifacts.push({ studentId: event.studentId, stageId: event.stageId, type: stage.output, you: result.state.students[event.studentId]! });
        } else if (stage?.output && wasDone && isDone) {
          // RE-completion (e.g. avatar re-pick while the class gate waits): the recorded
          // Work is immutable and now diverges from the final outputs/certificate — must
          // be COUNTABLE, never silent (one-Work-per-completion stays the frozen rule).
          traces.push(this.mkTrace("stage_transition", {
            reason: "workspace_work_stale_recomplete",
            studentId: event.studentId, stageId: event.stageId, type: stage.output, sessionId,
          }));
        }
      }
      // FORCE_ADVANCE past an artifact stage leaves a portfolio HOLE — enumerate it per
      // student at lesson end so holes are countable (frozen: "holes are operator-visible").
      if (completed) {
        for (const [studentId, you] of Object.entries(completed.students)) {
          for (const st of this.lesson.stages) {
            if (st.output && you.stageStatus[st.stageId] !== "completed") {
              traces.push(this.mkTrace("stage_transition", {
                reason: "workspace_work_skipped_stage_not_completed",
                studentId, stageId: st.stageId, type: st.output, sessionId,
              }));
            }
          }
        }
      }
      return {
        next: persist ? result.state : undefined,
        out: { broadcasts, traces, calls, prepares, ...(completed && { completed }), ...(artifacts.length > 0 && { artifacts }) },
      };
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
    // Phase 2: artifact works (fire-and-forget; failures traced, classroom untouched).
    for (const artifact of effects.artifacts ?? []) {
      void this.recordStageWork(sessionId, artifact);
    }
    // Phase 1 (Step 6): persistent profile write-back at lesson end — fire-and-forget,
    // NEVER blocks the classroom; every skip/failure is an operator-visible trace.
    if (effects.completed) {
      void this.writeBackProfiles(sessionId, effects.completed).catch((err: unknown) =>
        this.trace.record(this.mkTrace("stage_transition", { reason: "profile_writeback_crashed", error: String((err as Error)?.name ?? err), sessionId })),
      );
      // Phase 3: parent share links (per attending student; same isolation discipline).
      if (this.shareMinter) {
        const { lessonId, students } = effects.completed;
        for (const [studentId, you] of Object.entries(students)) {
          // A student who completed NO artifact stage (force-advance past both, late join)
          // gets a HOLLOW link — minted anyway (the view is a live read; works may land
          // later), but flagged in the trace AND the sink so the operator never forwards
          // an empty page unknowingly (degradation principle: countable, not silent).
          const hasArtifacts = this.lesson.stages.some(
            (st) => st.output !== undefined && you.stageStatus[st.stageId] === "completed",
          );
          void this.shareMinter
            .mintAndNotify({ studentId, studentDisplayName: you.displayName ?? "", lessonId, hasArtifacts })
            .then(() => this.trace.record(this.mkTrace("stage_transition", { reason: "share_mint_ok", sessionId, studentId, lessonId, hasArtifacts })))
            .catch((err: unknown) =>
              this.trace.record(this.mkTrace("stage_transition", {
                reason: "share_mint_failed", sessionId, studentId, lessonId,
                error: String((err as Error)?.name ?? err),
              })),
            );
        }
      } else {
        this.trace.record(this.mkTrace("stage_transition", { reason: "share_mint_skipped_not_wired", sessionId, lessonId: effects.completed.lessonId }));
      }
    }
  }

  /**
   * Write each student's lesson completion + companion fields to the persistent profile.
   *
   * LEAD-SERIALIZED DIVERGENCE from the identity.md lifecycle: the contract sketches
   * stage-level geniusX writes ("After stage completion ..."); Phase 1 writes them at
   * LESSON end only (classroom isolation: one DB touchpoint, fire-and-forget). A class
   * aborted before the final stage loses companion fields — documented in
   * docs/migration/mvp-to-phase1.md; per-stage writes arrive with the Phase 2 workspace
   * (DF-v2-14). Completion semantics are ATTENDANCE-based: every student present in the
   * session at the final-stage transition gets the lesson recorded (see the runbook).
   *
   * Per-student isolation: one failure never stops the others; errors are traced with
   * code/name only (NO raw messages — PII discipline). Degraded or missing companion
   * content is FLAGGED in the trace — never a silent normal path (AGENTS.md).
   */
  private async writeBackProfiles(
    sessionId: string,
    completed: { lessonId: string; students: Record<string, StudentRuntimeState> },
    mode: "lesson_end" | "late_prepare" = "lesson_end",
  ): Promise<void> {
    const { lessonId, students } = completed;
    if (!this.identity) {
      this.trace.record(
        this.mkTrace("stage_transition", {
          reason: "profile_writeback_skipped_identity_not_wired",
          sessionId,
          lessonId,
          studentCount: Object.keys(students).length,
        }),
      );
      return;
    }
    // Stages whose interaction pre-generates the birth speech (config-driven, not "birth").
    const speechStageIds = new Set(
      this.lesson.stages
        .filter((st) => (st.interaction ?? st.variants?.[0]?.interaction)?.type === "birth_speech")
        .map((st) => st.stageId),
    );
    // Lesson-001 coupling, traced when absent: the avatar profile field maps to this
    // declared output key (a per-lesson output→profile map is future work, see DF-v2-14).
    const AVATAR_OUTPUT_KEY = "avatarUrl";
    const avatarExpected = this.lesson.declaredOutputs.includes(AVATAR_OUTPUT_KEY);

    for (const [studentId, s] of Object.entries(students)) {
      try {
        const geniusX: { avatarUrl?: string; birthdaySpeech?: string } = {};
        const avatar = s.outputs[AVATAR_OUTPUT_KEY];
        if (typeof avatar === "string" && avatar !== "") geniusX.avatarUrl = avatar;
        // Select among the speech-stage prepared entries; PREFER non-degraded content.
        const candidates = Object.values(s.prepared).filter(
          (p) => speechStageIds.has(p.stageId) && p.ready && typeof p.output.text === "string" && p.output.text !== "",
        );
        const chosen = candidates.find((p) => !p.degraded) ?? candidates[0];
        if (chosen) geniusX.birthdaySpeech = chosen.output.text as string;
        await this.identity.recordLessonCompletion(studentId, lessonId, geniusX);
        this.trace.record(
          this.mkTrace("stage_transition", {
            reason: "profile_writeback_ok",
            mode,
            sessionId,
            studentId,
            lessonId,
            // Operator-visible content quality (degradation principle): a preset/fallback
            // line persisted as the speech, or expected fields absent, must be countable.
            ...(chosen?.degraded && { degraded: true }),
            ...(speechStageIds.size > 0 && !chosen && { birthdaySpeechMissing: true }),
            ...(avatarExpected && geniusX.avatarUrl === undefined && { avatarUrlMissing: true }),
          }),
        );
      } catch (err) {
        this.trace.record(
          this.mkTrace("stage_transition", {
            reason: "profile_writeback_failed",
            mode,
            sessionId,
            studentId,
            lessonId,
            error: err instanceof IdentityServiceError ? err.code : String((err as Error)?.name ?? err),
          }),
        );
      }
    }
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
      // NOTE: artifact/lesson-end detection lives ONLY in applyEvent — safe because the
      // reducer never completes a stage nor advances the class from INTERACTION_DONE
      // (counts only). If that ever changes, route these effects through applyEvent.
      const result = this.reducer(s, { type: "INTERACTION_DONE", studentId, stageId, interactionId, degraded }, this.clock.now());
      const persist = result.commands.some((c) => c.type === "PERSIST");
      const traces = result.commands.filter((c): c is Extract<EngineCommand, { type: "TRACE" }> => c.type === "TRACE").map((c) => c.event);
      return { next: persist ? result.state : undefined, out: { ok: persist, traces } };
    });
    for (const t of accepted.traces) this.trace.record(t);
    if (accepted.ok) this.emit.toStudent(sessionId, studentId, { type: "AI_OUTPUT", studentId, stageId, interactionId, output });

    // Phase 2: persist the exchange (fire-and-forget; resolves to undefined on failure so
    // the memory write below can still link when it succeeded).
    const recorded = accepted.ok
      ? this.recordInteractionToWorkspace(sessionId, studentId, stageId, input, output, degraded, transcript)
      : Promise.resolve(undefined);

    // Memory extraction (contracts-v1.4): for an extracting talent input, reuse the ASR transcript
    // to mine one memory. Runs AFTER the reply (never blocks it) and ALWAYS feeds
    // MEMORY_EXTRACTION_DONE — even if the reply was stale — so `pendingMemory` drains and birth
    // pre-generation can proceed.
    if (this.wantsMemory(stageId, input)) await this.runMemoryExtraction(sessionId, studentId, stageId, interactionId, transcript, recorded);
  }

  /** True when the reducer seeded `pendingMemory` for this input (must match the reducer's rule). */
  private wantsMemory(stageId: string, input: Extract<EngineCommand, { type: "CALL_INTERACTION" }>["input"]): boolean {
    const i = stageById(this.lesson, stageId)?.interaction;
    if (!i || i.type !== "multimodal_talent" || !i.memoryExtraction) return false;
    return input.kind === "voice" || input.kind === "talentAnswer";
  }

  /** Mine one memory from the transcript, then drain it (with/without a memory) via the reducer. */
  private async runMemoryExtraction(
    sessionId: string,
    studentId: string,
    stageId: string,
    interactionId: string,
    transcript: string | undefined,
    recorded: Promise<InteractionRecord | undefined> = Promise.resolve(undefined),
  ): Promise<void> {
    let memory: { key: string; value: string } | undefined;
    if (transcript) {
      try {
        const m = await this.gateway.extractMemory({ transcript, allowedKeys: this.lesson.declaredMemoryKeys, promptVersion: "memory_v1", studentId, stageId });
        if (m.key && m.value) memory = { key: m.key, value: m.value };
      } catch (err) {
        this.trace.record(this.mkTrace("interaction", { reason: "extract_memory_threw", error: String(err), interactionId, studentId }));
      }
    }
    // Phase 2: persist the mined memory too — linked to its workspace interaction record
    // when that write succeeded (the runtime wire `interactionId` is a DIFFERENT namespace).
    if (memory) {
      const found = memory;
      void recorded.then((rec) => this.recordMemoryToWorkspace(sessionId, studentId, stageId, found, rec?.id));
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
    // the prepared output must be PLAYABLE — a child taps once and must hear something. If the
    // gateway degraded to nothing, use a friendly preset台词 (invisible to the child, degraded for
    // operators) so a `ready` entry is never empty (PRD §0 + the playPrepared ready-gate).
    if (!output.text && !output.audioUrl && !(output.imageUrls && output.imageUrls.length)) {
      output = { text: BIRTH_FALLBACK_LINE };
      degraded = true;
    }

    const accepted = await this.store.update<{ ok: boolean; traces: TraceEvent[]; late?: { lessonId: string; you: StudentRuntimeState } }>(sessionId, async (session) => {
      const guard = this.guardSession(session, sessionId);
      if (guard) return { out: { ok: false, traces: [guard] } };
      const s = session as ClassSession;
      const result = this.reducer(s, { type: "PREPARE_DONE", studentId, stageId, preparedId, output, outputKind, degraded }, this.clock.now());
      const persist = result.commands.some((c) => c.type === "PERSIST");
      const traces = result.commands.filter((c): c is Extract<EngineCommand, { type: "TRACE" }> => c.type === "TRACE").map((c) => c.event);
      // A slow prepare can resolve AFTER the class already transitioned into the final stage —
      // the lesson-end write-back snapshot missed this speech. Flag it for a supplemental,
      // idempotent single-student write (outside the mutex) so the speech is never lost.
      const finalStageId = this.lesson.stages[this.lesson.stages.length - 1]!.stageId;
      const late =
        persist && result.state.currentStageId === finalStageId
          ? { lessonId: s.lessonId, you: result.state.students[studentId]! }
          : undefined;
      return { next: persist ? result.state : undefined, out: { ok: persist, traces, ...(late && { late }) } };
    });
    for (const t of accepted.traces) this.trace.record(t);
    if (accepted.ok) this.emit.toStudent(sessionId, studentId, { type: "AI_READY", studentId, stageId, preparedId, outputKind });
    if (accepted.late) {
      const { lessonId, you } = accepted.late;
      void this.writeBackProfiles(sessionId, { lessonId, students: { [studentId]: you } }, "late_prepare").catch((err: unknown) =>
        this.trace.record(this.mkTrace("stage_transition", { reason: "profile_writeback_crashed", error: String((err as Error)?.name ?? err), sessionId })),
      );
    }
  }

  /** Replay a pre-generated output — ONLY if it's the current stage and the entry is ready. Never
   *  emits an empty output (so AI_READY is a real server gate, not just a UI hint). */
  private async playPrepared(sessionId: string, studentId: string, stageId: string, preparedId: string): Promise<void> {
    // Validate UNDER the session mutex (like resume/INTERACTION_DONE) so a concurrent stage
    // transition can't slip between the read and the emit and let us replay a stale output.
    const result = await this.store.update<{ output?: ClientAiOutput; trace?: TraceEvent }>(sessionId, async (session) => {
      const guard = this.guardSession(session, sessionId);
      if (guard) return { out: { trace: guard } };
      const s = session as ClassSession;
      const prepared = s.students[studentId]?.prepared[preparedId];
      if (s.currentStageId !== stageId || !prepared || prepared.stageId !== stageId || !prepared.ready) {
        return { out: { trace: this.mkTrace("interaction", { dropped: true, reason: "play_not_ready_or_stale", preparedId, studentId, stageId }) } };
      }
      return { out: { output: prepared.output } }; // read-only: no `next` ⇒ no persist
    });
    if (result.trace) this.trace.record(result.trace);
    if (result.output) this.emit.toStudent(sessionId, studentId, { type: "AI_OUTPUT", studentId, stageId, interactionId: preparedId, output: result.output });
  }

  /** Project a child's prepared output to the big screen — registered-assistant only, ready-gated.
   *  Validated under the session mutex (no stale snapshot). */
  private async requestProjection(sessionId: string, msg: Extract<ClientMessage, { type: "REQUEST_PROJECTION" }>): Promise<void> {
    const result = await this.store.update<{ output?: ClientAiOutput; trace?: TraceEvent }>(sessionId, async (session) => {
      const guard = this.guardSession(session, sessionId);
      if (guard) return { out: { trace: guard } };
      const s = session as ClassSession;
      const student = s.students[msg.studentId];
      // requester must be a registered assistant (trusted-classroom MVP; cryptographic RBAC = Better
      // Auth, DF-8). Same posture as FORCE_ADVANCE — needs assistant registration (DF-M4-7).
      const isControlSurface = s.assistants.includes(msg.requestedBy);
      const ready = student && Object.values(student.prepared).find((p) => p.ready && p.stageId === s.currentStageId);
      if (!isControlSurface || !ready) {
        return { out: { trace: this.mkTrace("interaction", { dropped: true, reason: "projection_denied_or_not_ready", studentId: msg.studentId, requestedBy: msg.requestedBy }) } };
      }
      return { out: { output: ready.output } }; // read-only: no `next` ⇒ no persist
    });
    if (result.trace) this.trace.record(result.trace);
    if (result.output) this.emit.toSession(sessionId, { type: "PROJECT", studentId: msg.studentId, output: result.output });
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
      const you = s.students[studentId];
      if (!you) {
        // Phase 1 (Step 5): NEVER mint on HELLO. An unknown studentId here would recreate
        // the ephemeral fallback the enrollment contract forbids — over the WS, bypassing
        // the join's identity lookup and tenant check — and a phantom student would wedge
        // class-wide `allStudents` advance. Operator-visible deny; no RESUME_STATE.
        return {
          out: { trace: this.mkTrace("join_rejected", { denied: true, reason: "resume_unknown_student", studentId, sessionId }) },
        };
      }
      const msg: ServerMessage = {
        type: "RESUME_STATE",
        currentStageId: s.currentStageId,
        global: s.global,
        lessonConfigVersion: s.lessonConfigVersion,
        you,
      };
      return { out: { msg } };
    });
    if (result.trace) this.trace.record(result.trace);
    if (result.msg) this.emit.toStudent(sessionId, studentId, result.msg);
  }

  async resumeAssistant(sessionId: string, assistantId: string): Promise<void> {
    const result = await this.store.update<{ msg?: ServerMessage; trace?: TraceEvent }>(sessionId, async (session) => {
      const guard = this.guardSession(session, sessionId);
      if (guard) return { out: { trace: guard } };
      const s = session as ClassSession;
      // Assistants don't have personal state, just send the session state
      const msg: ServerMessage = {
        type: "RESUME_STATE",
        currentStageId: s.currentStageId,
        global: s.global,
        lessonConfigVersion: s.lessonConfigVersion,
        you: freshStudentState(), // Empty state for assistants
      };
      return { out: { msg } };
    });
    if (result.trace) this.trace.record(result.trace);
    if (result.msg) this.emit.toSession(sessionId, result.msg);
  }

  // --- Phase 2: workspace writes (all fire-and-forget; classroom NEVER blocked) ---

  /** False ⇒ workspace not wired; traced once PER SESSION (each class stays countable). */
  private ensureWorkspace(sessionId: string): boolean {
    if (this.workspace) return true;
    if (!this.workspaceSkipTraced.has(sessionId)) {
      this.workspaceSkipTraced.add(sessionId);
      this.trace.record(this.mkTrace("stage_transition", { reason: "workspace_writes_skipped_not_wired", sessionId }));
    }
    return false;
  }

  private traceWorkspaceFailure(what: string, sessionId: string, studentId: string, err: unknown): void {
    this.trace.record(
      this.mkTrace("stage_transition", {
        reason: "workspace_write_failed",
        what,
        sessionId,
        studentId,
        // Typed code, or PII-free pg fields — raw MESSAGES can carry row contents.
        error: err instanceof WorkspaceServiceError ? err.code : String((err as Error)?.name ?? err),
        ...((err as { code?: string })?.code && { dbCode: (err as { code?: string }).code }),
        ...((err as { constraint?: string })?.constraint && { constraint: (err as { constraint?: string }).constraint }),
      }),
    );
  }

  /** Persist one accepted exchange. Resolves to the record (for memory linking) or undefined. */
  private async recordInteractionToWorkspace(
    sessionId: string,
    studentId: string,
    stageId: string,
    input: Extract<EngineCommand, { type: "CALL_INTERACTION" }>["input"],
    output: ClientAiOutput,
    degraded: boolean,
    transcript: string | undefined,
  ): Promise<InteractionRecord | undefined> {
    if (!this.ensureWorkspace(sessionId)) return undefined;
    try {
      const contentRef = "audioRef" in input ? input.audioRef : "doodleRef" in input ? input.doodleRef : undefined;
      // Structured inputs persist as canonical JSON in `text` (workspace.md rule); a
      // talentAnswer keeps BOTH the chosen option and the transcript.
      const inputText =
        "answersByQuestionId" in input
          ? JSON.stringify(input.answersByQuestionId)
          : "option" in input && input.option !== undefined && transcript !== undefined
            ? JSON.stringify({ option: input.option, transcript })
            : (transcript ?? ("option" in input ? input.option : undefined));
      const images = output.imageUrls && output.imageUrls.length > 0;
      const outputKind = output.audioUrl ? "audio" : images ? "images" : output.text ? "text" : "none";
      // Image outputs (shape doodle/answers lines) persist their URL list as canonical
      // JSON — refs/URLs, never bytes (a single 512-char contentRef cannot hold 3 URLs).
      const outputText = images ? JSON.stringify(output.imageUrls) : output.text;
      return await this.workspace!.recordInteraction({
        studentId,
        occurredAt: this.clock.now(),
        context: { lessonId: this.lesson.lessonId, stageId, sessionId, initiatedBy: "student" },
        input: { kind: input.kind, ...(contentRef && { contentRef }), ...(inputText && { text: inputText }) },
        output: {
          kind: outputKind,
          ...(output.audioUrl && { contentRef: output.audioUrl }),
          ...(outputText && { text: outputText }),
          degraded,
        },
      });
    } catch (err) {
      this.traceWorkspaceFailure("interaction", sessionId, studentId, err);
      return undefined;
    }
  }

  private async recordMemoryToWorkspace(
    sessionId: string,
    studentId: string,
    stageId: string,
    memory: { key: string; value: string },
    sourceInteractionId: string | undefined,
  ): Promise<void> {
    if (!this.ensureWorkspace(sessionId)) return;
    try {
      await this.workspace!.recordMemory(
        {
          studentId,
          key: memory.key,
          value: memory.value,
          context: {
            lessonId: this.lesson.lessonId,
            stageId,
            sessionId,
            ...(sourceInteractionId && { sourceInteractionId }),
          },
        },
        { declaredMemoryKeys: this.lesson.declaredMemoryKeys },
      );
    } catch (err) {
      this.traceWorkspaceFailure("memory", sessionId, studentId, err);
    }
  }

  /** A completed stage that declares an artifact (stage.output) becomes a workspace Work. */
  private async recordStageWork(
    sessionId: string,
    artifact: { studentId: string; stageId: string; type: ArtifactType; you: StudentRuntimeState },
  ): Promise<void> {
    if (!this.ensureWorkspace(sessionId)) return;
    try {
      const content = this.buildWorkContent(artifact.type, artifact.you);
      if (!content) {
        // Content builder doesn't know this artifact type / required runtime fields absent —
        // operator-visible (DF-v2-14: per-lesson output→work map is the generalization).
        this.trace.record(
          this.mkTrace("stage_transition", {
            reason: "workspace_work_skipped_no_content",
            type: artifact.type,
            sessionId,
            studentId: artifact.studentId,
            stageId: artifact.stageId,
          }),
        );
        return;
      }
      const { degraded, skippedMemoryKeys, ...body } = content;
      if (skippedMemoryKeys && skippedMemoryKeys.length > 0) {
        // Mined memory keys the lesson's certificate.memoryLabels does NOT cover: excluded
        // from the parent-visible certificate (a raw snake_case key must never render as a
        // label on the parent surface) — countable, never silent.
        this.trace.record(this.mkTrace("stage_transition", {
          reason: "workspace_certificate_memory_unlabeled",
          keys: skippedMemoryKeys, sessionId, studentId: artifact.studentId, stageId: artifact.stageId,
        }));
      }
      await this.workspace!.recordWork(
        {
          studentId: artifact.studentId,
          type: artifact.type,
          ...body,
          metadata: { lessonId: this.lesson.lessonId, stageId: artifact.stageId, sessionId, degraded },
        },
        { declaredArtifactTypes: this.lesson.declaredArtifactTypes },
      );
    } catch (err) {
      this.traceWorkspaceFailure(`work:${artifact.type}`, sessionId, artifact.studentId, err);
    }
  }

  /**
   * Lesson-001 artifact content builders (couplings documented + skipped-with-trace when
   * absent; a per-lesson declarative output→work map is the generalization, DF-v2-14).
   */
  private buildWorkContent(
    type: ArtifactType,
    you: StudentRuntimeState,
  ): { contentUrl?: string; contentText?: string; contentJson?: Record<string, unknown>; degraded: boolean; skippedMemoryKeys?: string[] } | null {
    if (type === "avatar_image") {
      const url = you.outputs["avatarUrl"];
      return typeof url === "string" && url !== "" ? { contentUrl: url, degraded: false } : null;
    }
    if (type === "birth_certificate") {
      // BirthCertificate-shaped contentJson (student.ts): built from runtime memories +
      // outputs + the lesson's certificate labels. Blank fields stay "" (e.g. a child whose
      // 性格标签 was never mined) — renderers handle the gaps warmly.
      const labels: Record<string, string> = this.lesson.certificate?.memoryLabels ?? {};
      const speechStageIds = new Set(
        this.lesson.stages
          .filter((st) => (st.interaction ?? st.variants?.[0]?.interaction)?.type === "birth_speech")
          .map((st) => st.stageId),
      );
      const candidates = Object.values(you.prepared).filter(
        (p) => speechStageIds.has(p.stageId) && p.ready && typeof p.output.text === "string" && p.output.text !== "",
      );
      const chosen = candidates.find((p) => !p.degraded) ?? candidates[0];
      const avatarUrl = you.outputs["avatarUrl"];
      // Only LABELLED memory keys reach the certificate (DF-M4-3: "renders available
      // labelled memories") — an unlabeled key would leak its raw snake_case identifier as
      // a parent-visible label. Skipped keys are returned for an operator trace.
      const skippedMemoryKeys = Object.keys(you.memories).filter((k) => labels[k] === undefined);
      const certificate = {
        studentName: you.displayName ?? "",
        avatarUrl: typeof avatarUrl === "string" ? avatarUrl : "",
        personalityTag: you.memories["personality_tag"] ?? "",
        backgroundSetting: you.memories["background_setting"] ?? "",
        memories: Object.entries(you.memories)
          .filter(([key]) => labels[key] !== undefined)
          .map(([key, value]) => ({ label: labels[key]!, value })),
        birthdaySpeech: chosen?.output.text ?? "",
        generatedAt: this.clock.now(),
        lessonId: this.lesson.lessonId,
      };
      // AMENDED contract (workspace.md lifecycle 4): a PARTIAL certificate (any required
      // BirthCertificate field blank) is recorded with degraded:true — operator-visible
      // incomplete-content marker; a full one carries the speech's own degraded flag.
      const partial =
        certificate.avatarUrl === "" ||
        certificate.birthdaySpeech === "" ||
        certificate.personalityTag === "" ||
        certificate.backgroundSetting === "" ||
        certificate.studentName === "";
      return {
        contentJson: certificate,
        degraded: partial || (chosen?.degraded ?? false),
        ...(skippedMemoryKeys.length > 0 && { skippedMemoryKeys }),
      };
    }
    return null;
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
