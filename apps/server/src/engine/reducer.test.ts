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
    pending: {},
    outputs: {},
    memories: {},
    pendingMemory: [],
    prepared: {},
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

  it("INTERACT→INTERACTION_DONE increments the per-stage count", () => {
    let s = session("talent", ["k1"]);
    for (const id of ["i1", "i2"]) {
      s = reducer(s, { type: "INTERACT", studentId: "k1", stageId: "talent", interactionId: id, input: { kind: "talentOption", option: "sing" } }, NOW).state;
      s = reducer(s, { type: "INTERACTION_DONE", studentId: "k1", stageId: "talent", interactionId: id, degraded: false }, NOW).state;
    }
    expect(s.students.k1!.interactionCounts.talent).toBe(2);
    expect(s.students.k1!.completedInteractionIds).toEqual(["i1", "i2"]);
  });

  it("drops a duplicate INTERACT (no second pending / no second CALL_INTERACTION)", () => {
    const s = session("talent", ["k1"]);
    const first = reducer(s, { type: "INTERACT", studentId: "k1", stageId: "talent", interactionId: "i1", input: { kind: "talentOption", option: "sing" } }, NOW);
    expect(first.commands.some((c) => c.type === "CALL_INTERACTION")).toBe(true);
    const dup = reducer(first.state, { type: "INTERACT", studentId: "k1", stageId: "talent", interactionId: "i1", input: { kind: "talentOption", option: "sing" } }, NOW);
    expect(dup.commands.some((c) => c.type === "CALL_INTERACTION")).toBe(false);
    expect(dup.commands).toContainEqual({ type: "TRACE", event: expect.objectContaining({ payload: expect.objectContaining({ dropped: true }) }) });
  });

  it("drops an INTERACT whose id was already completed", () => {
    let s = session("talent", ["k1"]);
    s = reducer(s, { type: "INTERACT", studentId: "k1", stageId: "talent", interactionId: "i1", input: { kind: "talentOption", option: "sing" } }, NOW).state;
    s = reducer(s, { type: "INTERACTION_DONE", studentId: "k1", stageId: "talent", interactionId: "i1", degraded: false }, NOW).state;
    const again = reducer(s, { type: "INTERACT", studentId: "k1", stageId: "talent", interactionId: "i1", input: { kind: "talentOption", option: "sing" } }, NOW);
    expect(again.commands.some((c) => c.type === "CALL_INTERACTION")).toBe(false);
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

  it("INTERACTION_DONE is idempotent (only a pending id counts)", () => {
    let s = session("talent", ["k1"]);
    s = reducer(s, { type: "INTERACT", studentId: "k1", stageId: "talent", interactionId: "i1", input: { kind: "talentOption", option: "sing" } }, NOW).state;
    s = reducer(s, { type: "INTERACTION_DONE", studentId: "k1", stageId: "talent", interactionId: "i1", degraded: false }, NOW).state;
    const r = reducer(s, { type: "INTERACTION_DONE", studentId: "k1", stageId: "talent", interactionId: "i1", degraded: false }, NOW); // not pending now
    expect(r.state.students.k1!.interactionCounts.talent).toBe(1); // not 2
  });

  it("emits a fallback trace for a degraded interaction", () => {
    let s = session("talent", ["k1"]);
    s = reducer(s, { type: "INTERACT", studentId: "k1", stageId: "talent", interactionId: "i1", input: { kind: "talentOption", option: "sing" } }, NOW).state;
    const r = reducer(s, { type: "INTERACTION_DONE", studentId: "k1", stageId: "talent", interactionId: "i1", degraded: true }, NOW);
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
    // talent→birth gate: 2 interactions each (INTERACT sets pending, INTERACTION_DONE counts)
    for (const [k, ids] of [["k1", ["a", "b"]], ["k2", ["c", "d"]]] as const) {
      for (const id of ids) {
        step({ type: "INTERACT", studentId: k, stageId: "talent", interactionId: id, input: { kind: "talentOption", option: "sing" } });
        step({ type: "INTERACTION_DONE", studentId: k, stageId: "talent", interactionId: id, degraded: false });
      }
    }
    step({ type: "UNLOCK", role: "assistant", stageId: "birth" });
    expect(s.currentStageId).toBe("birth");
    // birth→closure gate: all students completed
    step({ type: "STUDENT_COMPLETE", studentId: "k1", stageId: "birth", payload: { kind: "done" } });
    step({ type: "STUDENT_COMPLETE", studentId: "k2", stageId: "birth", payload: { kind: "done" } });
    step({ type: "UNLOCK", role: "teacher", stageId: "closure" });
    expect(s.currentStageId).toBe("closure");
  });
});

describe("reducer — memory + birth pre-generation (contracts-v1.4)", () => {
  it("seeds pendingMemory on a talent voice/answer INTERACT and drains + writes a valid memory", () => {
    const s = session("talent", ["k1"]);
    const r1 = reducer(s, { type: "INTERACT", studentId: "k1", stageId: "talent", interactionId: "i1", input: { kind: "talentAnswer", audioRef: "ref" } }, NOW);
    expect(r1.state.students.k1!.pendingMemory).toEqual(["i1"]);
    expect(r1.commands.some((c) => c.type === "CALL_INTERACTION")).toBe(true);

    const r2 = reducer(r1.state, { type: "MEMORY_EXTRACTION_DONE", studentId: "k1", stageId: "talent", interactionId: "i1", memory: { key: "favorite_toy", value: "奥特曼" } }, NOW);
    expect(r2.state.students.k1!.pendingMemory).toEqual([]);
    expect(r2.state.students.k1!.memories.favorite_toy).toBe("奥特曼");
  });

  it("does NOT seed pendingMemory for a talentOption (no audio to mine)", () => {
    const s = session("talent", ["k1"]);
    const r = reducer(s, { type: "INTERACT", studentId: "k1", stageId: "talent", interactionId: "i1", input: { kind: "talentOption", option: "sing" } }, NOW);
    expect(r.state.students.k1!.pendingMemory).toEqual([]);
  });

  it("drops an undeclared memory key but still drains pendingMemory", () => {
    let s = session("talent", ["k1"]);
    s.students.k1!.pendingMemory = ["i1"];
    const r = reducer(s, { type: "MEMORY_EXTRACTION_DONE", studentId: "k1", stageId: "talent", interactionId: "i1", memory: { key: "not_declared", value: "x" } }, NOW);
    expect(r.state.students.k1!.pendingMemory).toEqual([]);
    expect(r.state.students.k1!.memories).toEqual({});
    expect(r.commands).toContainEqual({ type: "TRACE", event: expect.objectContaining({ payload: expect.objectContaining({ reason: "invalid_memory" }) }) });
  });

  it("birth-unlock with settled memories mints a ready:false placeholder + CALL_PREPARE", () => {
    const s = session("talent", ["k1"]);
    s.students.k1!.interactionCounts = { talent: 2 }; // meet talent→birth gate (minInteractions:2)
    const r = reducer(s, { type: "UNLOCK", role: "assistant", stageId: "birth" }, NOW);
    expect(r.state.currentStageId).toBe("birth");
    const prep = r.commands.find((c) => c.type === "CALL_PREPARE");
    expect(prep && prep.type === "CALL_PREPARE" && prep.outputKind).toBe("audio");
    expect(prep && prep.type === "CALL_PREPARE" && prep.promptVersion).toBe("birth_speech_v1");
    const preparedId = prep && prep.type === "CALL_PREPARE" ? prep.preparedId : "";
    expect(r.state.students.k1!.prepared[preparedId]!.ready).toBe(false);
    expect(r.state.students.k1!.prepared[preparedId]!.output).toEqual({});
  });

  it("birth-unlock with an in-flight memory defers CALL_PREPARE until it drains", () => {
    const s = session("talent", ["k1"]);
    s.students.k1!.interactionCounts = { talent: 2 };
    s.students.k1!.pendingMemory = ["i9"];
    const unlocked = reducer(s, { type: "UNLOCK", role: "assistant", stageId: "birth" }, NOW);
    expect(unlocked.commands.some((c) => c.type === "CALL_PREPARE")).toBe(false);
    expect(Object.keys(unlocked.state.students.k1!.prepared)).toEqual([]);

    const drained = reducer(unlocked.state, { type: "MEMORY_EXTRACTION_DONE", studentId: "k1", stageId: "talent", interactionId: "i9" }, NOW);
    expect(drained.commands.some((c) => c.type === "CALL_PREPARE")).toBe(true);
  });

  it("PREPARE_DONE fills the placeholder ready (idempotent — a duplicate is dropped)", () => {
    const s = session("talent", ["k1"]);
    s.students.k1!.interactionCounts = { talent: 2 };
    const unlocked = reducer(s, { type: "UNLOCK", role: "assistant", stageId: "birth" }, NOW);
    const prep = unlocked.commands.find((c) => c.type === "CALL_PREPARE");
    const preparedId = prep && prep.type === "CALL_PREPARE" ? prep.preparedId : "";

    const done = reducer(unlocked.state, { type: "PREPARE_DONE", studentId: "k1", stageId: "birth", preparedId, output: { text: "轩轩你好", audioUrl: "u" }, outputKind: "audio", degraded: false }, NOW);
    expect(done.state.students.k1!.prepared[preparedId]!.ready).toBe(true);
    expect(done.state.students.k1!.prepared[preparedId]!.output.text).toBe("轩轩你好");

    const dup = reducer(done.state, { type: "PREPARE_DONE", studentId: "k1", stageId: "birth", preparedId, output: { text: "different" }, outputKind: "audio", degraded: false }, NOW);
    expect(dup.state.students.k1!.prepared[preparedId]!.output.text).toBe("轩轩你好"); // unchanged
    expect(dup.commands.some((c) => c.type === "PERSIST")).toBe(false);
  });

  it("denies a playPrepared INTERACT (it is handled out-of-band, not via the reducer)", () => {
    const s = session("birth", ["k1"]);
    const r = reducer(s, { type: "INTERACT", studentId: "k1", stageId: "birth", interactionId: "p1", input: { kind: "playPrepared", preparedId: "x" } }, NOW);
    expect(r.state.students.k1!.pending).toEqual({});
    expect(r.commands).toContainEqual({ type: "TRACE", event: expect.objectContaining({ payload: expect.objectContaining({ denied: true }) }) });
  });
});

describe("reducer — M4a hardening (Codex review)", () => {
  it("a duplicate/late MEMORY_EXTRACTION_DONE (id not pending) is a no-op — no memory write, no prepare", () => {
    let s = session("talent", ["k1"]);
    s.students.k1!.interactionCounts = { talent: 2 };
    s.students.k1!.memories = { favorite_toy: "奥特曼" };
    // id "iX" is NOT in pendingMemory → must be dropped without touching memory or minting prepare
    const r = reducer(s, { type: "MEMORY_EXTRACTION_DONE", studentId: "k1", stageId: "talent", interactionId: "iX", memory: { key: "favorite_toy", value: "OVERWRITE" } }, NOW);
    expect(r.state.students.k1!.memories.favorite_toy).toBe("奥特曼"); // unchanged
    expect(r.commands.some((c) => c.type === "CALL_PREPARE")).toBe(false);
    expect(r.commands.some((c) => c.type === "PERSIST")).toBe(false);
  });

  it("PREPARE_DONE with an empty output is rejected (never marked ready → never replays a blank)", () => {
    const s = session("talent", ["k1"]);
    s.students.k1!.interactionCounts = { talent: 2 };
    const unlocked = reducer(s, { type: "UNLOCK", role: "assistant", stageId: "birth" }, NOW);
    const prep = unlocked.commands.find((c) => c.type === "CALL_PREPARE");
    const preparedId = prep && prep.type === "CALL_PREPARE" ? prep.preparedId : "";
    const done = reducer(unlocked.state, { type: "PREPARE_DONE", studentId: "k1", stageId: "birth", preparedId, output: {}, outputKind: "audio", degraded: true }, NOW);
    expect(done.state.students.k1!.prepared[preparedId]!.ready).toBe(false); // still a placeholder
    expect(done.commands.some((c) => c.type === "PERSIST")).toBe(false);
  });
});
