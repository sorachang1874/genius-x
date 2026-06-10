import { describe, it, expect, beforeEach } from "vitest";
import type { ClassSession, ServerMessage, TraceEvent, StudentRuntimeState } from "@genius-x/contracts";
import { lesson001 } from "@genius-x/course-config";
import { makeReducer } from "../engine";
import { InMemorySessionStore } from "../session/store";
import { ClassroomController, type Emitter, type TraceSink, type Clock } from "./controller";
import { AiGateway, FakeProvider, KeywordSafetyFilter, PresetFallbackLibrary } from "@genius-x/ai-gateway";

const NOW = "2026-06-03T00:00:00.000Z";
const clock: Clock = { now: () => NOW };
function makeGateway(trace: TraceSink): AiGateway {
  return new AiGateway({ provider: new FakeProvider(), safety: new KeywordSafetyFilter(), fallback: new PresetFallbackLibrary(), trace, now: () => NOW });
}

class FakeEmitter implements Emitter {
  session: { sessionId: string; msg: ServerMessage }[] = [];
  student: { sessionId: string; studentId: string; msg: ServerMessage }[] = [];
  toSession(sessionId: string, msg: ServerMessage) { this.session.push({ sessionId, msg }); }
  toStudent(sessionId: string, studentId: string, msg: ServerMessage) { this.student.push({ sessionId, studentId, msg }); }
}
class FakeTrace implements TraceSink {
  events: TraceEvent[] = [];
  record(e: TraceEvent) { this.events.push(e); }
}

function freshStudent(over: Partial<StudentRuntimeState> = {}): StudentRuntimeState {
  return { stageStatus: {}, interactionCounts: {}, completedInteractionIds: [], selectedVariant: {}, pending: {}, outputs: {}, memories: {}, pendingMemory: [], prepared: {}, ...over };
}

function seed(currentStageId: string, students: Record<string, StudentRuntimeState>): ClassSession {
  return {
    sessionId: "s1", tenantId: "demo-tenant", lessonId: "lesson-001", lessonConfigVersion: "1.1.0", classId: "c1",
    currentStageId, global: "active", stageStartTime: NOW, students, assistants: ["a1"],
  };
}

let store: InMemorySessionStore;
let emit: FakeEmitter;
let trace: FakeTrace;
let controller: ClassroomController;

beforeEach(() => {
  store = new InMemorySessionStore();
  emit = new FakeEmitter();
  trace = new FakeTrace();
  controller = new ClassroomController(lesson001, makeReducer(lesson001), store, emit, trace, clock, makeGateway(trace));
});

describe("ClassroomController", () => {
  it("ASSISTANT_UNLOCK advances and broadcasts STAGE_UNLOCK; persists", async () => {
    await store.save(seed("intro", { k1: freshStudent(), k2: freshStudent() }));
    await controller.onMessage("s1", { type: "ASSISTANT_UNLOCK", stageId: "icebreak", assistantId: "a1" });
    expect(emit.session).toContainEqual({ sessionId: "s1", msg: { type: "STAGE_UNLOCK", stageId: "icebreak" } });
    expect((await store.load("s1"))!.currentStageId).toBe("icebreak");
  });

  it("TEACHER_UNLOCK can reach a teacher-gated stage (birth→closure)", async () => {
    await store.save(seed("birth", { k1: freshStudent({ stageStatus: { birth: "completed" } }) }));
    await controller.onMessage("s1", { type: "TEACHER_UNLOCK", stageId: "closure" });
    expect((await store.load("s1"))!.currentStageId).toBe("closure");
  });

  it("HELLO replies RESUME_STATE with the authoritative state to the student", async () => {
    await store.save(seed("shape", { k1: freshStudent({ outputs: { avatarUrl: "u1" } }) }));
    await controller.onMessage("s1", { type: "HELLO", studentId: "k1" });
    expect(emit.student).toHaveLength(1);
    const msg = emit.student[0]!.msg;
    expect(msg.type).toBe("RESUME_STATE");
    if (msg.type === "RESUME_STATE") {
      expect(msg.currentStageId).toBe("shape");
      expect(msg.lessonConfigVersion).toBe("1.1.0");
      expect(msg.you.outputs.avatarUrl).toBe("u1");
    }
  });

  it("HELLO from an UNKNOWN student is denied with a join_rejected trace — never minted (Phase 1)", async () => {
    await store.save(seed("intro", {}));
    await controller.onMessage("s1", { type: "HELLO", studentId: "newk" });
    expect((await store.load("s1"))!.students.newk).toBeUndefined(); // no phantom student
    expect(emit.student).toHaveLength(0); // no RESUME_STATE for a denied resume
    const denied = trace.events.find((e) => e.kind === "join_rejected");
    expect(denied?.payload).toMatchObject({ denied: true, reason: "resume_unknown_student", studentId: "newk" });
  });

  it("STAGE_COMPLETE selection persists the output", async () => {
    await store.save(seed("shape", { k1: freshStudent() }));
    await controller.onMessage("s1", { type: "STAGE_COMPLETE", studentId: "k1", stageId: "shape", payload: { kind: "selection", output: "avatarUrl", value: "u1" } });
    expect((await store.load("s1"))!.students.k1!.outputs.avatarUrl).toBe("u1");
  });

  it("traces (does not crash) on an unknown session", async () => {
    await controller.onMessage("ghost", { type: "ASSISTANT_UNLOCK", stageId: "icebreak", assistantId: "a1" });
    expect(trace.events.some((e) => (e.payload as { reason?: string }).reason === "unknown session")).toBe(true);
  });

  it("fails closed on a version-mismatched session (no RESUME emitted)", async () => {
    await store.save({ ...seed("shape", { k1: freshStudent() }), lessonConfigVersion: "9.9.9" });
    await controller.onMessage("s1", { type: "HELLO", studentId: "k1" });
    expect(emit.student).toHaveLength(0);
    expect(trace.events.some((e) => (e.payload as { reason?: string }).reason === "invalid session")).toBe(true);
  });

  it("rejects FORCE_ADVANCE with a stale expectedCurrentStageId", async () => {
    await store.save(seed("shape", { k1: freshStudent() }));
    await controller.onMessage("s1", { type: "FORCE_ADVANCE", stageId: "talent", assistantId: "a1", expectedCurrentStageId: "intro" });
    expect((await store.load("s1"))!.currentStageId).toBe("shape"); // unchanged
  });

  it("INTERACT drives the gateway → AI_OUTPUT to the student + counts the interaction", async () => {
    await store.save(seed("talent", { k1: freshStudent() }));
    await controller.onMessage("s1", { type: "INTERACT", studentId: "k1", stageId: "talent", interactionId: "i1", input: { kind: "talentOption", option: "sing" } });
    // runInteraction is fire-and-forget (calls the async gateway, then INTERACTION_DONE) — poll for it
    await waitUntil(async () => ((await store.load("s1"))!.students.k1!.interactionCounts.talent ?? 0) >= 1);
    expect(emit.student.some((s) => s.msg.type === "AI_OUTPUT")).toBe(true);
    expect((await store.load("s1"))!.students.k1!.completedInteractionIds).toContain("i1");
  });

  it("does NOT deliver AI_OUTPUT for a stale interaction (class advanced mid-call)", async () => {
    const slow = new AiGateway({ provider: new FakeProvider({ llm: { latencyMs: 40 } }), safety: new KeywordSafetyFilter(), fallback: new PresetFallbackLibrary(), trace, now: () => NOW });
    const c = new ClassroomController(lesson001, makeReducer(lesson001), store, emit, trace, clock, slow);
    await store.save(seed("talent", { k1: freshStudent() }));
    await c.onMessage("s1", { type: "INTERACT", studentId: "k1", stageId: "talent", interactionId: "i1", input: { kind: "talentOption", option: "sing" } });
    await c.onMessage("s1", { type: "FORCE_ADVANCE", stageId: "birth", assistantId: "a1" }); // advance while gateway is mid-call
    await new Promise((r) => setTimeout(r, 120));
    expect(emit.student.some((s) => s.msg.type === "AI_OUTPUT")).toBe(false);
    const loaded = (await store.load("s1"))!;
    expect(loaded.students.k1!.interactionCounts.talent ?? 0).toBe(0);
    expect(loaded.students.k1!.pending.i1).toBeUndefined(); // stale pending cleared
    expect(trace.events.some((e) => (e.payload as { reason?: string }).reason === "stale_interaction")).toBe(true);
  });
});

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe("ClassroomController — concurrency (no lost update)", () => {
  class SlowStore extends InMemorySessionStore {
    override async load(id: string) {
      await new Promise((r) => setTimeout(r, 5));
      return super.load(id);
    }
  }

  it("serializes concurrent completions so neither student's output is lost", async () => {
    const slow = new SlowStore();
    await slow.save(seed("shape", { k1: freshStudent(), k2: freshStudent() }));
    const c = new ClassroomController(lesson001, makeReducer(lesson001), slow, emit, trace, clock, makeGateway(trace));
    await Promise.all([
      c.onMessage("s1", { type: "STAGE_COMPLETE", studentId: "k1", stageId: "shape", payload: { kind: "selection", output: "avatarUrl", value: "u1" } }),
      c.onMessage("s1", { type: "STAGE_COMPLETE", studentId: "k2", stageId: "shape", payload: { kind: "selection", output: "avatarUrl", value: "u2" } }),
    ]);
    const s = await slow.load("s1");
    expect(s!.students.k1!.outputs.avatarUrl).toBe("u1");
    expect(s!.students.k2!.outputs.avatarUrl).toBe("u2");
  });
});

// --- Phase 1 Step 6: lesson-end profile write-back (final-review mandates) ---

import type { IdentityService } from "../identity/service";

class FakeIdentity {
  calls: { studentId: string; lessonId: string; geniusX: { avatarUrl?: string; birthdaySpeech?: string } }[] = [];
  async recordLessonCompletion(
    studentId: string,
    lessonId: string,
    geniusX: { avatarUrl?: string; birthdaySpeech?: string } = {},
  ): Promise<never> {
    this.calls.push({ studentId, lessonId, geniusX });
    return undefined as never;
  }
}

function untilTrue(check: () => boolean, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (check()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error("untilTrue timeout"));
      setTimeout(tick, 5);
    };
    tick();
  });
}

describe("lesson-end profile write-back", () => {
  function birthDone(over: Partial<StudentRuntimeState> = {}): StudentRuntimeState {
    return freshStudent({ stageStatus: { birth: "completed" }, ...over });
  }
  function withIdentity(identity: FakeIdentity): ClassroomController {
    return new ClassroomController(
      lesson001, makeReducer(lesson001), store, emit, trace, clock, makeGateway(trace),
      identity as unknown as IdentityService,
    );
  }

  it("extracts avatar + birth speech (per speech-stage prepared entry) and traces ok", async () => {
    const identity = new FakeIdentity();
    const c = withIdentity(identity);
    await store.save(seed("birth", {
      k1: birthDone({
        outputs: { avatarUrl: "u9" },
        prepared: { p1: { stageId: "birth", outputKind: "audio", ready: true, output: { text: "生日快乐呀" }, degraded: false, preparedAt: NOW } },
      }),
    }));
    await c.onMessage("s1", { type: "TEACHER_UNLOCK", stageId: "closure" });
    await untilTrue(() => identity.calls.length === 1);
    expect(identity.calls[0]).toEqual({
      studentId: "k1", lessonId: "lesson-001",
      geniusX: { avatarUrl: "u9", birthdaySpeech: "生日快乐呀" },
    });
    const ok = trace.events.find((e) => e.payload.reason === "profile_writeback_ok");
    expect(ok?.payload.degraded).toBeUndefined();
    expect(ok?.payload.birthdaySpeechMissing).toBeUndefined();
  });

  it("persists a DEGRADED speech but flags it in the trace (never a silent normal path)", async () => {
    const identity = new FakeIdentity();
    const c = withIdentity(identity);
    await store.save(seed("birth", {
      k1: birthDone({
        prepared: { p1: { stageId: "birth", outputKind: "audio", ready: true, output: { text: "预设台词" }, degraded: true, preparedAt: NOW } },
      }),
    }));
    await c.onMessage("s1", { type: "TEACHER_UNLOCK", stageId: "closure" });
    await untilTrue(() => identity.calls.length === 1);
    expect(identity.calls[0]!.geniusX.birthdaySpeech).toBe("预设台词");
    const ok = trace.events.find((e) => e.payload.reason === "profile_writeback_ok");
    expect(ok?.payload.degraded).toBe(true); // operator-visible at the durable boundary
  });

  it("prefers a non-degraded speech when both exist; flags MISSING speech/avatar otherwise", async () => {
    const identity = new FakeIdentity();
    const c = withIdentity(identity);
    await store.save(seed("birth", {
      k1: birthDone({
        prepared: {
          pBad: { stageId: "birth", outputKind: "audio", ready: true, output: { text: "备用" }, degraded: true, preparedAt: NOW },
          pGood: { stageId: "birth", outputKind: "audio", ready: true, output: { text: "真台词" }, degraded: false, preparedAt: NOW },
        },
      }),
      k2: birthDone(), // nothing produced at all
    }));
    await c.onMessage("s1", { type: "TEACHER_UNLOCK", stageId: "closure" });
    await untilTrue(() => identity.calls.length === 2);
    const k1 = identity.calls.find((x) => x.studentId === "k1")!;
    expect(k1.geniusX.birthdaySpeech).toBe("真台词");
    const missing = trace.events.find((e) => e.payload.reason === "profile_writeback_ok" && e.payload.studentId === "k2");
    expect(missing?.payload.birthdaySpeechMissing).toBe(true);
    expect(missing?.payload.avatarUrlMissing).toBe(true);
  });

  it("fires exactly once: a repeat unlock at closure does NOT re-write", async () => {
    const identity = new FakeIdentity();
    const c = withIdentity(identity);
    await store.save(seed("birth", { k1: birthDone() }));
    await c.onMessage("s1", { type: "TEACHER_UNLOCK", stageId: "closure" });
    await untilTrue(() => identity.calls.length === 1);
    await c.onMessage("s1", { type: "TEACHER_UNLOCK", stageId: "closure" }); // already there
    await new Promise((r) => setTimeout(r, 30));
    expect(identity.calls).toHaveLength(1);
  });

  it("identity absent → operator-visible skip trace, classroom unaffected", async () => {
    await store.save(seed("birth", { k1: birthDone() })); // default `controller` has no identity
    await controller.onMessage("s1", { type: "TEACHER_UNLOCK", stageId: "closure" });
    await untilTrue(() => trace.events.some((e) => e.payload.reason === "profile_writeback_skipped_identity_not_wired"));
    expect((await store.load("s1"))!.currentStageId).toBe("closure"); // class advanced fine
  });

  it("RACE: a prepare resolving AFTER closure fires a supplemental write with the speech", async () => {
    const identity = new FakeIdentity();
    const slowGateway = new AiGateway({
      provider: new FakeProvider({ llm: { latencyMs: 120 } }),
      safety: new KeywordSafetyFilter(), fallback: new PresetFallbackLibrary(), trace, now: () => NOW,
    });
    const c = new ClassroomController(
      lesson001, makeReducer(lesson001), store, emit, trace, clock, slowGateway,
      identity as unknown as IdentityService,
    );
    // Entering birth mints the prepared placeholder + CALL_PREPARE (slow). Complete birth and
    // unlock closure BEFORE the prepare resolves — the lesson-end snapshot misses the speech.
    await store.save(seed("talent", { k1: freshStudent({ stageStatus: { talent: "completed" }, interactionCounts: { talent: 2 } }) }));
    await c.onMessage("s1", { type: "FORCE_ADVANCE", stageId: "birth", assistantId: "a1" });
    await c.onMessage("s1", { type: "STAGE_COMPLETE", studentId: "k1", stageId: "birth", payload: { kind: "done" } });
    await c.onMessage("s1", { type: "TEACHER_UNLOCK", stageId: "closure" });
    await untilTrue(() => identity.calls.length >= 2, 3000); // lesson_end + late_prepare
    const late = identity.calls[identity.calls.length - 1]!;
    expect(typeof late.geniusX.birthdaySpeech).toBe("string");
    expect(late.geniusX.birthdaySpeech!.length).toBeGreaterThan(0); // the late speech LANDS
    expect(trace.events.some((e) => e.payload.reason === "profile_writeback_ok" && e.payload.mode === "late_prepare")).toBe(true);
  });
});
