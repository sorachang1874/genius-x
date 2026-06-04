import { describe, it, expect } from "vitest";
import type { ClassSession } from "@genius-x/contracts";
import { InMemorySessionStore } from "./store";

function session(): ClassSession {
  return {
    sessionId: "s1",
    lessonId: "lesson-001",
    lessonConfigVersion: "1.1.0",
    classId: "c1",
    currentStageId: "intro",
    global: "active",
    stageStartTime: "2026-06-03T00:00:00.000Z",
    students: { k1: { stageStatus: {}, interactionCounts: {}, completedInteractionIds: [], selectedVariant: {}, pending: {}, outputs: {}, memories: {}, pendingMemory: [], prepared: {} } },
    assistants: ["a1"],
  };
}

describe("InMemorySessionStore", () => {
  it("round-trips a session by id (deep copy via JSON)", async () => {
    const store = new InMemorySessionStore();
    const s = session();
    await store.save(s);
    const loaded = await store.load("s1");
    expect(loaded).toEqual(s);
    expect(loaded).not.toBe(s); // stored as a serialized copy, not a reference
  });

  it("returns null for an unknown session", async () => {
    expect(await new InMemorySessionStore().load("nope")).toBeNull();
  });
});
