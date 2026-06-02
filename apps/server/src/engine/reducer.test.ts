import { describe, it, expect } from "vitest";
import type { ClassSession, StudentRuntimeState } from "@genius-x/contracts";
import { lesson001 } from "@genius-x/course-config";
import { makeReducer } from "./reducer";

const NOW = "2026-06-03T00:00:00.000Z";
const reducer = makeReducer(lesson001);

function student(): StudentRuntimeState {
  return {
    stageStatus: {},
    interactionCounts: {},
    completedInteractionIds: [],
    selectedVariant: {},
    outputs: {},
  };
}

function session(currentStageId: string, studentIds: string[]): ClassSession {
  const students: Record<string, StudentRuntimeState> = {};
  for (const id of studentIds) students[id] = student();
  return {
    sessionId: "s1",
    lessonId: "lesson-001",
    lessonConfigVersion: "1.0.0",
    classId: "c1",
    currentStageId,
    global: "active",
    stageStartTime: NOW,
    students,
    assistants: ["a1"],
  };
}

describe("reducer — advancement", () => {
  it("UNLOCK advances intro→icebreak (immediate, assistant) and broadcasts", () => {
    const r = reducer(session("intro", ["k1", "k2"]), { type: "UNLOCK", role: "assistant", stageId: "icebreak" }, NOW);
    expect(r.state.currentStageId).toBe("icebreak");
    expect(r.commands).toContainEqual({ type: "BROADCAST", message: { type: "STAGE_UNLOCK", stageId: "icebreak" } });
    expect(r.commands.some((c) => c.type === "PERSIST")).toBe(true);
  });

  it("denies UNLOCK with the wrong role (icebreak is assistant-unlocked)", () => {
    const r = reducer(session("intro", ["k1"]), { type: "UNLOCK", role: "teacher", stageId: "icebreak" }, NOW);
    expect(r.state.currentStageId).toBe("intro"); // unchanged
    expect(r.commands).toEqual([
      { type: "TRACE", event: expect.objectContaining({ kind: "stage_transition", payload: expect.objectContaining({ denied: true }) }) },
    ]);
  });

  it("denies UNLOCK to a non-adjacent stage", () => {
    const r = reducer(session("intro", ["k1"]), { type: "UNLOCK", role: "assistant", stageId: "talent" }, NOW);
    expect(r.state.currentStageId).toBe("intro");
  });

  it("gates shape→talent on allStudents outputSet avatarUrl", () => {
    const s = session("shape", ["k1", "k2"]);
    // not met yet
    const blocked = reducer(s, { type: "UNLOCK", role: "assistant", stageId: "talent" }, NOW);
    expect(blocked.state.currentStageId).toBe("shape");
    // set avatarUrl for both
    s.students.k1!.outputs.avatarUrl = "u1";
    s.students.k2!.outputs.avatarUrl = "u2";
    const ok = reducer(s, { type: "UNLOCK", role: "assistant", stageId: "talent" }, NOW);
    expect(ok.state.currentStageId).toBe("talent");
  });

  it("FORCE_ADVANCE bypasses the guard and audits", () => {
    const r = reducer(session("shape", ["k1", "k2"]), { type: "FORCE_ADVANCE", stageId: "talent", assistantId: "a1", reason: "straggler" }, NOW);
    expect(r.state.currentStageId).toBe("talent");
    expect(r.commands).toContainEqual({ type: "TRACE", event: expect.objectContaining({ kind: "force_advance" }) });
  });
});

describe("reducer — student state", () => {
  it("STUDENT_COMPLETE selection sets output + marks stage completed", () => {
    const r = reducer(session("shape", ["k1"]), { type: "STUDENT_COMPLETE", studentId: "k1", stageId: "shape", payload: { kind: "selection", output: "avatarUrl", value: "u1" } }, NOW);
    expect(r.state.students.k1!.outputs.avatarUrl).toBe("u1");
    expect(r.state.students.k1!.stageStatus.shape).toBe("completed");
  });

  it("variantChoice records the selected variant", () => {
    const r = reducer(session("shape", ["k1"]), { type: "STUDENT_COMPLETE", studentId: "k1", stageId: "shape", payload: { kind: "variantChoice", variantId: "drawing" } }, NOW);
    expect(r.state.students.k1!.selectedVariant.shape).toBe("drawing");
  });

  it("INTERACTION_DONE increments the per-stage count", () => {
    let s = session("talent", ["k1"]);
    s = reducer(s, { type: "INTERACTION_DONE", studentId: "k1", stageId: "talent", interactionId: "i1", degraded: false }, NOW).state;
    s = reducer(s, { type: "INTERACTION_DONE", studentId: "k1", stageId: "talent", interactionId: "i2", degraded: true }, NOW).state;
    expect(s.students.k1!.interactionCounts.talent).toBe(2);
    expect(s.students.k1!.completedInteractionIds).toEqual(["i1", "i2"]);
  });

  it("GLOBAL sets class state and broadcasts", () => {
    const r = reducer(session("closure", ["k1"]), { type: "GLOBAL", state: "synced" }, NOW);
    expect(r.state.global).toBe("synced");
    expect(r.commands).toContainEqual({ type: "BROADCAST", message: { type: "GLOBAL_STATE", state: "synced" } });
  });

  it("unknown student is denied, state unchanged", () => {
    const r = reducer(session("talent", ["k1"]), { type: "INTERACTION_DONE", studentId: "ghost", stageId: "talent", interactionId: "i1", degraded: false }, NOW);
    expect(r.state.students.ghost).toBeUndefined();
  });
});

describe("reducer — safety guards", () => {
  it("denies a STUDENT_COMPLETE for a non-current stage (stale/foreign)", () => {
    const r = reducer(session("intro", ["k1"]), { type: "STUDENT_COMPLETE", studentId: "k1", stageId: "shape", payload: { kind: "selection", output: "avatarUrl", value: "u" } }, NOW);
    expect(r.state.students.k1!.outputs.avatarUrl).toBeUndefined();
    expect(r.commands).toEqual([{ type: "TRACE", event: expect.objectContaining({ payload: expect.objectContaining({ denied: true }) }) }]);
  });

  it("denies a selection with an undeclared output", () => {
    const r = reducer(session("shape", ["k1"]), { type: "STUDENT_COMPLETE", studentId: "k1", stageId: "shape", payload: { kind: "selection", output: "nope", value: "x" } }, NOW);
    expect(r.state.students.k1!.outputs.nope).toBeUndefined();
  });

  it("denies a selection the current stage does not write (intro cannot set avatarUrl)", () => {
    const r = reducer(session("intro", ["k1"]), { type: "STUDENT_COMPLETE", studentId: "k1", stageId: "intro", payload: { kind: "selection", output: "avatarUrl", value: "x" } }, NOW);
    expect(r.state.students.k1!.outputs.avatarUrl).toBeUndefined();
    expect(r.state.students.k1!.stageStatus.intro).not.toBe("completed");
  });

  it("denies a variantChoice not offered by the stage", () => {
    const r = reducer(session("shape", ["k1"]), { type: "STUDENT_COMPLETE", studentId: "k1", stageId: "shape", payload: { kind: "variantChoice", variantId: "xyz" } }, NOW);
    expect(r.state.students.k1!.selectedVariant.shape).toBeUndefined();
  });

  it("INTERACTION_DONE is idempotent on a duplicate id", () => {
    let s = session("talent", ["k1"]);
    s = reducer(s, { type: "INTERACTION_DONE", studentId: "k1", stageId: "talent", interactionId: "i1", degraded: false }, NOW).state;
    const r = reducer(s, { type: "INTERACTION_DONE", studentId: "k1", stageId: "talent", interactionId: "i1", degraded: false }, NOW);
    expect(r.state.students.k1!.interactionCounts.talent).toBe(1); // not 2
  });

  it("emits a fallback trace for a degraded interaction", () => {
    const r = reducer(session("talent", ["k1"]), { type: "INTERACTION_DONE", studentId: "k1", stageId: "talent", interactionId: "i1", degraded: true }, NOW);
    expect(r.commands).toContainEqual({ type: "TRACE", event: expect.objectContaining({ kind: "fallback", payload: expect.objectContaining({ degraded: true }) }) });
  });

  it("denies FORCE_ADVANCE from an unknown assistant", () => {
    const r = reducer(session("shape", ["k1"]), { type: "FORCE_ADVANCE", stageId: "talent", assistantId: "ghost" }, NOW);
    expect(r.state.currentStageId).toBe("shape"); // unchanged
  });
});

describe("reducer — full Lesson 1 walk", () => {
  it("advances intro→icebreak→shape→talent→birth→closure via config + guards", () => {
    let s = session("intro", ["k1", "k2"]);
    const step = (e: Parameters<typeof reducer>[1]) => {
      s = reducer(s, e, NOW).state;
    };
    step({ type: "UNLOCK", role: "assistant", stageId: "icebreak" });
    expect(s.currentStageId).toBe("icebreak");
    step({ type: "UNLOCK", role: "assistant", stageId: "shape" });
    expect(s.currentStageId).toBe("shape");
    // shape→talent gate: both students pick an avatar
    step({ type: "STUDENT_COMPLETE", studentId: "k1", stageId: "shape", payload: { kind: "selection", output: "avatarUrl", value: "a1" } });
    step({ type: "STUDENT_COMPLETE", studentId: "k2", stageId: "shape", payload: { kind: "selection", output: "avatarUrl", value: "a2" } });
    step({ type: "UNLOCK", role: "assistant", stageId: "talent" });
    expect(s.currentStageId).toBe("talent");
    // talent→birth gate: 2 interactions each
    for (const [k, ids] of [["k1", ["a", "b"]], ["k2", ["c", "d"]]] as const) {
      for (const id of ids) step({ type: "INTERACTION_DONE", studentId: k, stageId: "talent", interactionId: id, degraded: false });
    }
    step({ type: "UNLOCK", role: "assistant", stageId: "birth" });
    expect(s.currentStageId).toBe("birth");
    // birth→closure gate: all students completed
    step({ type: "STUDENT_COMPLETE", studentId: "k1", stageId: "birth", payload: { kind: "interaction", interactionId: "b1" } });
    step({ type: "STUDENT_COMPLETE", studentId: "k2", stageId: "birth", payload: { kind: "interaction", interactionId: "b2" } });
    step({ type: "UNLOCK", role: "teacher", stageId: "closure" });
    expect(s.currentStageId).toBe("closure");
  });
});
