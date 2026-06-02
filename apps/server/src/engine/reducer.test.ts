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
