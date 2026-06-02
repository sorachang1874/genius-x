import { describe, it, expect } from "vitest";
import type { ClassSession } from "@genius-x/contracts";
import { lesson001 } from "@genius-x/course-config";
import { validateClassSessionForLesson } from "./validateSession";

function session(over: Partial<ClassSession> = {}): ClassSession {
  return {
    sessionId: "s1",
    lessonId: "lesson-001",
    lessonConfigVersion: "1.0.0",
    classId: "c1",
    currentStageId: "shape",
    global: "active",
    stageStartTime: "2026-06-03T00:00:00.000Z",
    students: {},
    assistants: [],
    ...over,
  };
}

describe("validateClassSessionForLesson", () => {
  it("accepts a matching session", () => {
    expect(validateClassSessionForLesson(session(), lesson001)).toEqual([]);
  });

  it("flags a lessonConfigVersion mismatch (fail closed on resume)", () => {
    const errs = validateClassSessionForLesson(session({ lessonConfigVersion: "9.9.9" }), lesson001);
    expect(errs.some((e) => e.includes("RESUME_VERSION_MISMATCH"))).toBe(true);
  });

  it("flags a currentStageId not in the lesson", () => {
    const errs = validateClassSessionForLesson(session({ currentStageId: "ghost" }), lesson001);
    expect(errs.some((e) => e.includes("not in loaded lesson"))).toBe(true);
  });

  it("flags a lessonId mismatch", () => {
    const errs = validateClassSessionForLesson(session({ lessonId: "lesson-999" }), lesson001);
    expect(errs.length).toBeGreaterThan(0);
  });
});
