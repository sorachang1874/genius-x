import { describe, it, expect } from "vitest";
import type { LessonConfig } from "@genius-x/contracts";
import { lesson001 } from "@genius-x/course-config";
import { validateLessonConfig } from "./validate";

const clone = (x: LessonConfig): LessonConfig => JSON.parse(JSON.stringify(x)) as LessonConfig;

describe("validateLessonConfig", () => {
  it("accepts lesson-001 (the instance #1)", () => {
    expect(validateLessonConfig(lesson001).ok).toBe(true);
  });

  it("rejects a duplicate stageId", () => {
    const bad = clone(lesson001);
    bad.stages.push({ ...bad.stages[0]! });
    const r = validateLessonConfig(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("duplicate stageId"))).toBe(true);
  });

  it("rejects an advanceCondition referencing an undeclared output", () => {
    const bad = clone(lesson001);
    bad.stages[2]!.advanceCondition = { type: "allStudents", of: { kind: "outputSet", output: "nope" } };
    const r = validateLessonConfig(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("undeclared output"))).toBe(true);
  });

  it("rejects a certificate label referencing an undeclared memory key (fails closed)", () => {
    const bad = clone(lesson001);
    bad.certificate = { memoryLabels: { not_a_declared_key: "标签" } };
    const r = validateLessonConfig(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("undeclared memory key"))).toBe(true);
  });

  it("rejects a malformed config (missing required field)", () => {
    const bad = clone(lesson001) as Partial<LessonConfig>;
    delete bad.lessonConfigVersion;
    expect(validateLessonConfig(bad).ok).toBe(false);
  });

  it("rejects an empty all/any combinator (would advance vacuously)", () => {
    const bad = clone(lesson001);
    bad.stages[1]!.advanceCondition = { type: "all", conditions: [] };
    expect(validateLessonConfig(bad).ok).toBe(false);
  });

  it("rejects an empty variants array", () => {
    const bad = clone(lesson001);
    bad.stages[2]!.variants = [];
    expect(validateLessonConfig(bad).ok).toBe(false);
  });

  it("rejects a no-op stage (empty appState, no interaction/variants)", () => {
    const bad = clone(lesson001);
    bad.stages[0] = { stageId: "x", name: "x", duration: 1, unlock: "teacher", advanceCondition: { type: "immediate" }, appState: {} };
    expect(validateLessonConfig(bad).ok).toBe(false);
  });
});
