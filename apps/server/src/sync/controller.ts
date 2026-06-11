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
import { EPISODE_MEMORY_KEY, PROMPT_ASSEMBLY_TOKEN_RE, clampTurnText } from "@genius-x/contracts";
import type { LlmTextResult, TurnBufferEntry } from "@genius-x/contracts";
import type { AiGateway } from "@genius-x/ai-gateway";
import type { TurnBufferStore } from "../session/turnbuffer";
import { toolById } from "@genius-x/course-config";
import type { Reducer } from "../engine";
import { stageById, terminalStageId } from "../engine/nextStage";
import type { SessionStore } from "../session/store";
import { validateClassSessionForLesson } from "../session/validateSession";
import { IdentityServiceError, type IdentityService } from "../identity/service";
import { WorkspaceServiceError, type WorkspaceService } from "../workspace/service";
import type { IpCharacterService } from "../workspace/ip-character";
import type { IpCharacterSurface } from "@genius-x/contracts";
import { ContextBuilder } from "../agent/context";
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
  /** Set on ANY class-wide stage transition — the exited SCENE (Phase 4 consolidation +
   *  per-student round counters, decision ⑥: counters-not-limits). */
  sceneExited?: { stageId: string; studentIds: string[]; rounds: Record<string, number> };
  /** Round-cap denials (Phase 4 floor): the runtime serves the warm wrap-up per entry. */
  capReached?: { studentId: string; stageId: string; interactionId: string }[];
  /** Tool denials (Phase 5): the runtime serves the warm redirect per entry. */
  toolDenied?: { studentId: string; stageId: string; interactionId: string }[];
}

/** The friend's WARM WRAP-UP when a round cap is reached (decision ⑦ default) — the child
 *  taps and hears the friend wind the scene down, NEVER a dead button. Child-safe wording. */
const CAP_WRAP_UP_LINE = "我们聊得好开心呀！先把现在的做完，待会儿还有更好玩的等着我们～";

/** The friend's warm REDIRECT when a tool/option isn't available here (tool.md) —
 *  countable for operators, never a dead button. Child-safe wording. */
const TOOL_REDIRECT_LINE = "这个魔法我们待会儿再玩～先试试现在这个好不好？";

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
    /**
     * Phase 4 (hot path, agent-context.md): the in-scene turn buffer. OPTIONAL — absence
     * (one trace per session) or any read/append failure degrades the call to STATELESS
     * (`context_degraded` trace); the classroom never blocks on context.
     */
    private readonly turnBuffer?: TurnBufferStore,
    /**
     * Phase 4.5: the IP character entity (lesson-end snapshot/refine + works lineage +
     * the canon source). OPTIONAL — absence is a deployment state (traced at lesson end),
     * failures are per-student traces; the classroom never blocks.
     */
    private readonly ipCharacter?: IpCharacterService,
  ) {
    // Phase 4 cold path (agent-context.md): built from the SAME deps — no new wiring
    // surface. P4.5-B: the canon source prefers the ip_characters record (mirror fallback).
    this.contextBuilder = new ContextBuilder(identity, workspace, ipCharacter, trace, () => clock.now());
  }

  private readonly contextBuilder: ContextBuilder;

  private readonly workspaceSkipTraced = new Set<string>();
  private readonly turnBufferSkipTraced = new Set<string>();
  /** In-flight scene consolidations per session — the lesson-end sweep MUST wait for these
   *  (review-proven race: clearSession could delete buffers before consolidation drained
   *  them — silent episode loss). Fire-and-forget relative to the classroom throughout. */
  private readonly inflightConsolidations = new Map<string, Set<Promise<void>>>();

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
      const finalStageId = terminalStageId(this.lesson); // scene.md: terminal = no successors
      const completed =
        persist && before.currentStageId !== finalStageId && result.state.currentStageId === finalStageId
          ? { lessonId: before.lessonId, students: result.state.students }
          : undefined;
      // Phase 4 (agent-context.md): ANY class-wide stage exit is a SCENE exit — captured
      // here (consistent snapshot), consolidated outside the mutex (fire-and-forget).
      const sceneExited =
        persist && before.currentStageId !== result.state.currentStageId
          ? {
              stageId: before.currentStageId,
              studentIds: Object.keys(result.state.students),
              // Decision ⑥ (counters, not limits): per-student rounds of the exited scene.
              rounds: Object.fromEntries(
                Object.entries(result.state.students).map(([id, st]) => [id, st.interactionCounts[before.currentStageId] ?? 0]),
              ),
            }
          : undefined;
      const capReached = result.commands
        .filter((c): c is Extract<EngineCommand, { type: "CAP_REACHED" }> => c.type === "CAP_REACHED")
        .map((c) => ({ studentId: c.studentId, stageId: c.stageId, interactionId: c.interactionId }));
      const toolDenied = result.commands
        .filter((c): c is Extract<EngineCommand, { type: "TOOL_DENIED" }> => c.type === "TOOL_DENIED")
        .map((c) => ({ studentId: c.studentId, stageId: c.stageId, interactionId: c.interactionId }));
      // Phase 2: a student COMPLETING a stage that declares an artifact (stage.output)
      // produces a workspace Work — captured here (consistent snapshot), written outside.
      const artifacts: Effects["artifacts"] = [];
      if (persist && event.type === "STUDENT_COMPLETE") {
        const stage = stageById(this.lesson, event.stageId);
        const wasDone = before.students[event.studentId]?.stageStatus[event.stageId] === "completed";
        const isDone = result.state.students[event.studentId]?.stageStatus[event.stageId] === "completed";
        if (stage?.output && isDone) {
          // workspace.md v1.2 (Phase 4.5, decision ②): ONE Work per completion EVENT —
          // a RE-completion (in-scene refinement, the IP concept's normal creative path)
          // records its own immutable Work; the portfolio is the iteration history.
          // Iteration volume stays countable (workspace_work_iteration), never silent.
          artifacts.push({ studentId: event.studentId, stageId: event.stageId, type: stage.output, you: result.state.students[event.studentId]! });
          if (wasDone) {
            traces.push(this.mkTrace("stage_transition", {
              reason: "workspace_work_iteration",
              studentId: event.studentId, stageId: event.stageId, type: stage.output, sessionId,
            }));
          }
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
        out: { broadcasts, traces, calls, prepares, ...(completed && { completed }), ...(artifacts.length > 0 && { artifacts }), ...(sceneExited && { sceneExited }), ...(capReached.length > 0 && { capReached }), ...(toolDenied.length > 0 && { toolDenied }) },
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
    // Phase 4 floor: cap-reached children get the friend's WARM WRAP-UP (no AI call, no
    // dead button — decision ⑦ default); each serve is the countable round_cap_reached
    // trace the reducer already emitted.
    for (const cap of effects.capReached ?? []) {
      this.emit.toStudent(sessionId, cap.studentId, {
        type: "AI_OUTPUT", studentId: cap.studentId, stageId: cap.stageId, interactionId: cap.interactionId,
        output: { text: CAP_WRAP_UP_LINE },
      });
    }
    // Phase 5: undeclared tool/option ⇒ the friend's warm REDIRECT (same pattern).
    for (const deny of effects.toolDenied ?? []) {
      this.emit.toStudent(sessionId, deny.studentId, {
        type: "AI_OUTPUT", studentId: deny.studentId, stageId: deny.stageId, interactionId: deny.interactionId,
        output: { text: TOOL_REDIRECT_LINE },
      });
    }
    // Decision ⑥ (counters-not-limits): per-student scene round counters at scene exit.
    if (effects.sceneExited) {
      for (const [studentId, rounds] of Object.entries(effects.sceneExited.rounds)) {
        if (rounds > 0) {
          this.trace.record(this.mkTrace("interaction", { reason: "scene_counters", rounds, sessionId, studentId, stageId: effects.sceneExited.stageId }));
        }
      }
    }
    // Phase 4: end-of-scene episodic consolidation (fire-and-forget; per-student isolation;
    // failure = trace, the classroom never blocks — agent-context.md). Tracked per session
    // so the lesson-end sweep can sequence AFTER all in-flight consolidations.
    if (effects.sceneExited) {
      const inflight = this.inflightConsolidations.get(sessionId) ?? new Set<Promise<void>>();
      this.inflightConsolidations.set(sessionId, inflight);
      const p = this.consolidateScene(sessionId, effects.sceneExited).catch((err: unknown) =>
        this.trace.record(this.mkTrace("interaction", { reason: "episode_consolidation_crashed", error: String((err as Error)?.name ?? err), sessionId })),
      );
      inflight.add(p);
      void p.finally(() => inflight.delete(p));
    }
    // Phase 1 (Step 6): persistent profile write-back at lesson end — fire-and-forget,
    // NEVER blocks the classroom; every skip/failure is an operator-visible trace.
    if (effects.completed) {
      void this.writeBackProfiles(sessionId, effects.completed).catch((err: unknown) =>
        this.trace.record(this.mkTrace("stage_transition", { reason: "profile_writeback_crashed", error: String((err as Error)?.name ?? err), sessionId })),
      );
      // Phase 4 (owner-matrix deletion clause): lesson end sweeps the session's turn
      // buffers — AFTER every in-flight scene consolidation settles (review-proven race:
      // an eager sweep deleted not-yet-drained buffers ⇒ silent episode loss). Still
      // fire-and-forget relative to the classroom.
      const inflight = this.inflightConsolidations.get(sessionId);
      void Promise.allSettled(inflight ? [...inflight] : [])
        .then(() => this.turnBuffer?.clearSession(sessionId))
        .then(() => this.inflightConsolidations.delete(sessionId))
        .catch((err: unknown) =>
          this.trace.record(this.mkTrace("interaction", { reason: "context_sweep_failed", error: String((err as Error)?.name ?? err), sessionId })),
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
        const geniusX: { birthdaySpeech?: string } = {}; // projected fields flow via the IP mirror (P4.5-B)
        const avatar = s.outputs[AVATAR_OUTPUT_KEY];
        const avatarPresent = typeof avatar === "string" && avatar !== "";
        // Select among the speech-stage prepared entries; PREFER non-degraded content.
        const candidates = Object.values(s.prepared).filter(
          (p) => speechStageIds.has(p.stageId) && p.ready && typeof p.output.text === "string" && p.output.text !== "",
        );
        const chosen = candidates.find((p) => !p.degraded) ?? candidates[0];
        if (chosen) geniusX.birthdaySpeech = chosen.output.text as string;
        await this.identity.recordLessonCompletion(studentId, lessonId, geniusX);
        // P4.5-B: the IP character is the canonical companion record — lesson end creates
        // the v1 birth snapshot or refines a version; the mirror (inside the service) is
        // the SINGLE writer of the projected genius_x columns from here on.
        await this.recordIpOutcome(sessionId, studentId, s, lessonId, mode);
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
            ...(avatarExpected && !avatarPresent && { avatarUrlMissing: true }),
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
    let round: { childText: string; llm: LlmTextResult } | undefined;
    try {
      ({ output, degraded, transcript, round } = await this.callGateway(sessionId, cmd));
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
      // NOTE: artifact/lesson-end/SCENE-EXIT detection lives ONLY in applyEvent — safe
      // because the reducer never completes a stage nor advances the class from
      // INTERACTION_DONE (counts only). If that ever changes, route these effects
      // through applyEvent.
      const result = this.reducer(s, { type: "INTERACTION_DONE", studentId, stageId, interactionId, degraded }, this.clock.now());
      const persist = result.commands.some((c) => c.type === "PERSIST");
      const traces = result.commands.filter((c): c is Extract<EngineCommand, { type: "TRACE" }> => c.type === "TRACE").map((c) => c.event);
      return { next: persist ? result.state : undefined, out: { ok: persist, traces } };
    });
    for (const t of accepted.traces) this.trace.record(t);
    if (accepted.ok) this.emit.toStudent(sessionId, studentId, { type: "AI_OUTPUT", studentId, stageId, interactionId, output });
    // HOT-path buffering happens ONLY for ACCEPTED rounds (agent-context.md: "the buffer
    // is the conversation as experienced" — a stale round was never delivered).
    if (accepted.ok && round) this.bufferRound(sessionId, cmd, round);

    // Phase 2: persist the exchange (fire-and-forget; resolves to undefined on failure so
    // the memory write below can still link when it succeeded).
    // Safety status from the gateway's signal (agent-context.md safety parity item 3):
    // the recorder marks filtered exchanges so future readers can exclude/re-review them.
    const safety = round?.llm.meta.filtered === "input" ? "input_filtered" as const
      : round?.llm.meta.filtered === "output" ? "output_filtered" as const
      : "ok" as const;
    const recorded = accepted.ok
      ? this.recordInteractionToWorkspace(sessionId, studentId, stageId, input, output, degraded, transcript, safety)
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
      const finalStageId = terminalStageId(this.lesson); // scene.md: terminal = no successors (matches applyEvent)
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
  private async callGateway(
    sessionId: string,
    cmd: Extract<EngineCommand, { type: "CALL_INTERACTION" }>,
  ): Promise<{ output: ClientAiOutput; degraded: boolean; transcript?: string; round?: { childText: string; llm: LlmTextResult } }> {
    const { stageId, input } = cmd;
    const promptVersion = this.promptFor(stageId);
    let degraded = false;
    const mark = (m: { degraded: boolean }): void => { if (m.degraded) degraded = true; };
    switch (input.kind) {
      case "voice":
      case "talentAnswer": {
        // HOT context (prior rounds) + COLD context (canon + cross-lesson memories) fetch
        // in PARALLEL with ASR — none depends on the transcript; either failing ⇒ the
        // call proceeds with less context, traced — never blocked (agent-context.md).
        const [asr, history, cold] = await Promise.all([
          this.gateway.asr({ audioRef: input.audioRef }),
          this.readTurns(sessionId, cmd),
          this.contextBuilder.buildCold(sessionId, cmd.studentId),
        ]);
        mark(asr.meta);
        const llm = await this.gateway.llm({
          promptVersion, input: asr.transcript,
          ...(history.length > 0 && { history }),
          ...(cold && { context: { version: cold.version, text: cold.text } }),
        }); mark(llm.meta);
        const tts = await this.gateway.tts({ text: llm.text }); mark(tts.meta);
        // The round is buffered by the CALLER only after the reducer ACCEPTS the
        // completion — a stale round (dropped, never delivered) must not enter context.
        return { output: { text: llm.text, audioUrl: tts.audioUrl }, degraded, transcript: asr.transcript, round: { childText: asr.transcript, llm } };
      }
      case "talentOption": {
        // A talentOption is client-supplied — validate against the stage's DECLARED
        // options (the answers-fix pattern): undeclared free text neither prompts nor
        // persists; the trace carries ids only.
        let option = input.option;
        const stage = stageById(this.lesson, stageId);
        const ix = stage?.interaction ?? stage?.variants?.[0]?.interaction;
        if (ix?.type === "multimodal_talent" && !ix.options.includes(option)) {
          this.trace.record(this.mkTrace("interaction", {
            reason: "talent_option_not_declared", sessionId, stageId, studentId: cmd.studentId, interactionId: cmd.interactionId,
          }));
          option = "";
        }
        const [history, cold] = await Promise.all([
          this.readTurns(sessionId, cmd),
          this.contextBuilder.buildCold(sessionId, cmd.studentId),
        ]);
        const llm = await this.gateway.llm({
          promptVersion, input: option,
          ...(history.length > 0 && { history }),
          ...(cold && { context: { version: cold.version, text: cold.text } }),
        }); mark(llm.meta);
        const tts = await this.gateway.tts({ text: llm.text }); mark(tts.meta);
        return { output: { text: llm.text, audioUrl: tts.audioUrl }, degraded, round: { childText: option, llm } };
      }
      case "doodle": {
        // seed = studentId: degraded fallbacks stay per-child distinct (DF-v2-18).
        const img = await this.gateway.imageGen({ kind: "img2img", source: input.doodleRef, count: 3, seed: cmd.studentId }); mark(img.meta);
        return { output: { imageUrls: img.imageUrls }, degraded };
      }
      case "answers": {
        // brand-style.md: the lesson's promptAssembly is a SCENE template ({questionId} →
        // chosen option), assembled here; the BRAND suffix is the gateway's job, never ours.
        const source = this.assembleImagePrompt(sessionId, cmd, input.answersByQuestionId);
        const img = await this.gateway.imageGen({ kind: "text2img", source, count: 3, seed: cmd.studentId }); mark(img.meta);
        return { output: { imageUrls: img.imageUrls }, degraded };
      }
      case "refine": {
        // tool.md image_refine: the reducer already gated tool-declared-on-stage; here we
        // resolve registry/option/ownership — any miss is the warm redirect (countable),
        // never free text into a prompt and never another child's work.
        const tool = toolById(input.toolId);
        const option = tool?.options?.find((o) => o.id === input.optionId);
        const base = await this.refineBaseOwned(cmd.studentId, input.baseImageRef);
        if (!tool || tool.mechanic !== "image_refine" || !option || !base) {
          this.trace.record(this.mkTrace("interaction", {
            reason: "tool_denied",
            cause: !tool ? "tool_not_registered" : tool.mechanic !== "image_refine" ? "wrong_mechanic" : !option ? "option_not_declared" : "base_ref_not_owned", // (not-owned covers missing contentUrl too)
            toolId: input.toolId, optionId: input.optionId,
            sessionId, stageId, studentId: cmd.studentId, interactionId: cmd.interactionId,
          }));
          return { output: { text: TOOL_REDIRECT_LINE }, degraded: false };
        }
        const img = await this.gateway.imageGen({
          kind: "img2img",
          source: base.contentUrl,
          prompt: option.promptFragment, // SCENE content — the gateway appends the brand suffix
          count: 3,
          seed: cmd.studentId,
        }); mark(img.meta);
        this.trace.record(this.mkTrace("interaction", {
          reason: img.meta.degraded ? "tool_refine_degraded" : "tool_refine_ok",
          toolId: tool.toolId, toolVersion: tool.version, optionId: option.id,
          sessionId, stageId, studentId: cmd.studentId, interactionId: cmd.interactionId,
        }));
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

  /**
   * End-of-scene episodic consolidation (agent-context.md): for each student, DRAIN the
   * exited scene's turn buffer (exactly once) and — when the stage declares
   * `episodicMemory` — summarize it into ONE schema-validated episode written to the
   * workspace under the RESERVED `key="episode"`. Per-student isolation: one failure
   * never stops the others; every skip/failure is a countable trace.
   */
  private async consolidateScene(sessionId: string, exited: { stageId: string; studentIds: string[] }): Promise<void> {
    if (!this.turnBuffer) return; // absence already traced once per session
    const stage = stageById(this.lesson, exited.stageId);
    const episodic = stage?.episodicMemory === true;
    const hasWorkspace = episodic ? this.ensureWorkspace(sessionId) : false;
    // NOTE: consolidation stays SERIAL per student (each extractEpisode is individually
    // slot-gated inside the gateway — at most ONE slot held at a time, never across
    // students); the Step-5 gate bounds it alongside next-stage rounds. Parallelizing
    // the loop is a future option, not a pending dependency.
    for (const studentId of exited.studentIds) {
      const key = { sessionId, studentId, stageId: exited.stageId };
      try {
        // Drain UNCONDITIONALLY on scene exit (the deletion clause: buffers clear at scene
        // exit, episodic or not) — gates below decide whether the drained scene becomes an
        // episode, and an episodic scene discarded for a missing workspace is COUNTED.
        const entries = await this.turnBuffer.drain(key);
        if (entries.length === 0) continue; // nothing said this scene — nothing to remember
        if (!episodic) continue; // non-episodic scene: drained (cleanup), no episode by design
        if (!hasWorkspace) {
          this.trace.record(this.mkTrace("interaction", { reason: "episode_skipped_workspace_absent", ...key }));
          continue;
        }
        const episode = await this.gateway.extractEpisode({ rounds: entries, promptVersion: "episode_v1", studentId, stageId: exited.stageId });
        if (episode === null) {
          // The gateway already traced WHY (schema miss / safety); count the lost episode.
          this.trace.record(this.mkTrace("interaction", { reason: "episode_consolidation_failed", ...key }));
          continue;
        }
        await this.workspace!.recordMemory({
          studentId,
          key: EPISODE_MEMORY_KEY,
          value: JSON.stringify(episode),
          context: { lessonId: this.lesson.lessonId, stageId: exited.stageId, sessionId },
        });
        this.trace.record(this.mkTrace("interaction", { reason: "episode_consolidated", entries: entries.length, ...key }));
      } catch (err) {
        this.trace.record(this.mkTrace("interaction", {
          reason: "episode_consolidation_failed", error: String((err as Error)?.name ?? err), ...key,
        }));
      }
    }
  }

  /** tool.md v1: the refine base must be the student's OWN recorded work WITH a renderable
   *  contentUrl (same-student pointer discipline; in-flight candidates are a later slice).
   *  Returns the work (single fetch — the happy path reuses it) or null = deny. */
  private async refineBaseOwned(studentId: string, baseImageRef: string): Promise<{ contentUrl: string } | null> {
    if (!this.workspace) return null;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(baseImageRef)) return null;
    try {
      const w = await this.workspace.getWork(baseImageRef);
      return w.studentId === studentId && w.contentUrl ? { contentUrl: w.contentUrl } : null;
    } catch {
      return null;
    }
  }

  /** Once-per-session loud absence (deployment state, never a silent normal path). */
  private ensureTurnBuffer(sessionId: string): boolean {
    if (this.turnBuffer) return true;
    if (!this.turnBufferSkipTraced.has(sessionId)) {
      this.turnBufferSkipTraced.add(sessionId);
      this.trace.record(this.mkTrace("interaction", { reason: "context_buffer_not_wired", sessionId }));
    }
    return false;
  }

  /** HOT-path read (agent-context.md): failure ⇒ stateless call + `context_degraded` trace. */
  private async readTurns(
    sessionId: string,
    cmd: Extract<EngineCommand, { type: "CALL_INTERACTION" }>,
  ): Promise<TurnBufferEntry[]> {
    if (!this.ensureTurnBuffer(sessionId)) return [];
    try {
      return await this.turnBuffer!.read({ sessionId, studentId: cmd.studentId, stageId: cmd.stageId });
    } catch (err) {
      this.trace.record(this.mkTrace("interaction", {
        reason: "context_degraded", op: "read", error: String((err as Error)?.name ?? err),
        sessionId, studentId: cmd.studentId, stageId: cmd.stageId,
      }));
      return [];
    }
  }

  /**
   * Buffer the ACCEPTED round, both turns after the reply (agent-context.md): an
   * INPUT-filtered round is excluded entirely (the unsafe utterance must never re-enter a
   * prompt); an OUTPUT-filtered or provider-failure round buffers the SERVED text — the
   * buffer is the conversation as the child experienced it. An empty child turn (degraded
   * ASR) skips the round, countable. Oversized texts are clamped, countable. Appends are
   * fire-and-forget: failures trace, never block.
   */
  private bufferRound(
    sessionId: string,
    cmd: Extract<EngineCommand, { type: "CALL_INTERACTION" }>,
    round: { childText: string; llm: LlmTextResult },
  ): void {
    if (!this.turnBuffer) return; // absence already traced once per session at read
    if (round.llm.meta.filtered === "input") return;
    const key = { sessionId, studentId: cmd.studentId, stageId: cmd.stageId };
    if (round.childText === "") {
      this.trace.record(this.mkTrace("interaction", { reason: "context_round_skipped_empty", ...key }));
      return;
    }
    const child = clampTurnText(round.childText);
    const companion = clampTurnText(round.llm.text);
    if (child.clamped || companion.clamped) {
      this.trace.record(this.mkTrace("interaction", {
        reason: "turn_entry_truncated", child: child.clamped, companion: companion.clamped, ...key,
      }));
    }
    void this.turnBuffer
      .append(key, { role: "child", text: child.text })
      .then(() => this.turnBuffer!.append(key, { role: "companion", text: companion.text }))
      .catch((err: unknown) =>
        this.trace.record(this.mkTrace("interaction", {
          reason: "context_degraded", op: "append", error: String((err as Error)?.name ?? err), ...key,
        })),
      );
  }

  /** The prompt template a stage's interaction uses (falls back to a generic id). */
  private promptFor(stageId: string): string {
    const stage = stageById(this.lesson, stageId);
    const i = stage?.interaction ?? stage?.variants?.[0]?.interaction;
    return i && "promptTemplate" in i ? i.promptTemplate : "generic_v1";
  }

  /**
   * Assemble the structured_qa scene prompt: substitute each {questionId} token with the
   * child's chosen option (brand-style.md "Scene-content assembly"). The interaction is
   * resolved from the command's variantId (first-structured_qa scan only as the
   * no-variantId fallback). Substituted values are validated against the question's
   * DECLARED options — client free-text never reaches the image prompt (the gateway
   * additionally input-reviews the assembled source; layered defense). Every anomaly is a
   * countable trace with ids only (never answer values — child content stays out of logs).
   */
  private assembleImagePrompt(
    sessionId: string,
    cmd: Extract<EngineCommand, { type: "CALL_INTERACTION" }>,
    answers: Record<string, string>,
  ): string {
    const { stageId, studentId, interactionId, variantId } = cmd;
    const ids = { sessionId, stageId, studentId, interactionId };
    const stage = stageById(this.lesson, stageId);
    const fromVariant = variantId ? stage?.variants?.find((v) => v.id === variantId)?.interaction : undefined;
    const candidates = fromVariant
      ? [fromVariant]
      : [stage?.interaction, ...(stage?.variants?.map((v) => v.interaction) ?? [])];
    const qa = candidates.find((i) => i?.type === "structured_qa");
    if (!qa || qa.type !== "structured_qa" || qa.promptAssembly === undefined) {
      this.trace.record(this.mkTrace("interaction", { reason: "prompt_assembly_absent", ...ids }));
      return JSON.stringify(answers);
    }
    const questionById = new Map(qa.questions.map((q) => [q.id, q]));
    const missing: string[] = [];
    const notAnOption: string[] = [];
    const assembled = qa.promptAssembly.replace(PROMPT_ASSEMBLY_TOKEN_RE, (_m, id: string) => {
      const v = answers[id];
      if (v === undefined) {
        missing.push(id);
        return "";
      }
      const q = questionById.get(id);
      if (!q || !q.options.includes(v)) {
        // Client-supplied value outside the declared options: NEVER substituted (free text
        // must not reach the provider prompt). Trace carries the question id only.
        notAnOption.push(id);
        return "";
      }
      return v;
    });
    if (missing.length > 0) {
      this.trace.record(this.mkTrace("interaction", { reason: "prompt_assembly_missing_answer", missing, ...ids }));
    }
    if (notAnOption.length > 0) {
      this.trace.record(this.mkTrace("interaction", { reason: "prompt_assembly_answer_not_an_option", questionIds: notAnOption, ...ids }));
    }
    return assembled;
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
    safety: "ok" | "input_filtered" | "output_filtered" = "ok",
  ): Promise<InteractionRecord | undefined> {
    if (!this.ensureWorkspace(sessionId)) return undefined;
    try {
      const contentRef = "audioRef" in input ? input.audioRef : "doodleRef" in input ? input.doodleRef : undefined;
      // Structured inputs persist as canonical JSON in `text` (workspace.md rule); a
      // talentAnswer keeps BOTH the chosen option and the transcript.
      const inputText =
        "answersByQuestionId" in input
          ? JSON.stringify(input.answersByQuestionId)
          : "toolId" in input
            ? JSON.stringify({ toolId: input.toolId, optionId: input.optionId, baseImageRef: input.baseImageRef }) // tool.md rule 5: the interaction record IS the provenance (declared ids only)
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
        safety,
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

  /** Lesson-end IP snapshot/refine (ip-character.md): per-student isolation; every
   *  outcome countable (ip_snapshot_created / ip_backfill_partial / ip_refined /
   *  ip_refine_noop / ip_refine_failed / ip_write_skipped_not_wired). */
  private async recordIpOutcome(
    sessionId: string,
    studentId: string,
    s: StudentRuntimeState,
    lessonId: string,
    mode: "lesson_end" | "late_prepare",
  ): Promise<void> {
    if (!this.ipCharacter) {
      this.trace.record(this.mkTrace("stage_transition", { reason: "ip_write_skipped_not_wired", sessionId, studentId, lessonId }));
      return;
    }
    try {
      // appearanceRef = the newest avatar WORK (by seq). The work write is fire-and-forget
      // during the lesson, so it has long landed by lesson end; a lost write is simply not
      // captured this lesson (the late_prepare re-run or the next lesson catches up).
      const ref = await this.ipCharacter.newestAvatarRef(studentId);
      const patch: IpCharacterSurface = {
        ...(ref && { appearanceRef: ref }),
        ...(s.memories["personality_tag"] && { personality: s.memories["personality_tag"] }),
        ...(s.memories["background_setting"] && { backstory: s.memories["background_setting"] }),
      };
      const outcome = await this.ipCharacter.recordLessonOutcome(studentId, patch, { lessonId, sessionId });
      if (outcome.kind === "created") {
        this.trace.record(this.mkTrace("stage_transition", { reason: "ip_snapshot_created", version: 1, mode, sessionId, studentId, lessonId }));
        if (outcome.partialBackfill) {
          this.trace.record(this.mkTrace("stage_transition", { reason: "ip_backfill_partial", sessionId, studentId, lessonId }));
        }
      } else if (outcome.kind === "refined") {
        this.trace.record(this.mkTrace("stage_transition", { reason: "ip_refined", version: outcome.character.version, mode, sessionId, studentId, lessonId }));
      } else {
        this.trace.record(this.mkTrace("stage_transition", { reason: "ip_refine_noop", mode, sessionId, studentId, lessonId }));
      }
    } catch (err) {
      this.trace.record(this.mkTrace("stage_transition", {
        reason: "ip_refine_failed", mode, sessionId, studentId, lessonId,
        error: err instanceof WorkspaceServiceError ? err.code : String((err as Error)?.name ?? err),
      }));
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
      // Phase 4.5 lineage: stamp the version the artifact DERIVES FROM (current at record
      // time; the contract wording amendment pins this). Pre-character lesson-1 rows are
      // intentionally unstamped (not drift); a FAILED lookup while a character may exist
      // is countable (work_lineage_missing) — the work itself must still record.
      let ipCharacterVersion: number | undefined;
      if (this.ipCharacter) {
        try {
          ipCharacterVersion = (await this.ipCharacter.getCharacter(artifact.studentId))?.version;
        } catch (err) {
          this.trace.record(this.mkTrace("stage_transition", {
            reason: "work_lineage_missing", cause: "character_lookup_failed",
            error: String((err as Error)?.name ?? err),
            studentId: artifact.studentId, stageId: artifact.stageId, type: artifact.type, sessionId,
          }));
        }
      }
      await this.workspace!.recordWork(
        {
          studentId: artifact.studentId,
          type: artifact.type,
          ...body,
          metadata: {
            lessonId: this.lesson.lessonId, stageId: artifact.stageId, sessionId, degraded,
            ...(ipCharacterVersion !== undefined && { ipCharacterVersion }),
          },
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
