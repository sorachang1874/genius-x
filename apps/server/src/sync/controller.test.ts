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
