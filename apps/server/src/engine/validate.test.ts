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

describe("promptAssembly token validation (brand-style.md preflight)", () => {
  it("rejects a promptAssembly token that references an unknown question id (fails closed)", () => {
    const bad = clone(lesson001);
    const dialogue = bad.stages[2]!.variants!.find((v) => v.id === "dialogue")!;
    if (dialogue.interaction.type === "structured_qa") {
      dialogue.interaction.promptAssembly = "一只 {ears} 角色，{nope}背景";
    }
    const r = validateLessonConfig(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('unknown question id "nope"'))).toBe(true);
  });

  it("accepts templates whose tokens all reference declared question ids (lesson-001)", () => {
    expect(validateLessonConfig(lesson001).ok).toBe(true);
  });
});

describe("review-mandated preflights (P4 Step 1c)", () => {
  it("rejects a lesson declaring the RESERVED 'episode' memory key (agent-context.md)", () => {
    const bad = clone(lesson001);
    bad.declaredMemoryKeys.push("episode");
    const r = validateLessonConfig(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('reserved key "episode"'))).toBe(true);
  });

  it("rejects a non-tokenizable question id when a promptAssembly exists (CJK id would silently un-template)", () => {
    const bad = clone(lesson001);
    const dialogue = bad.stages[2]!.variants!.find((v) => v.id === "dialogue")!;
    if (dialogue.interaction.type === "structured_qa") {
      dialogue.interaction.questions[0]!.id = "耳朵";
    }
    const r = validateLessonConfig(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("not tokenizable"))).toBe(true);
  });

  it("rejects malformed token text (residual braces ship as literal text to the provider)", () => {
    const bad = clone(lesson001);
    const dialogue = bad.stages[2]!.variants!.find((v) => v.id === "dialogue")!;
    if (dialogue.interaction.type === "structured_qa") {
      dialogue.interaction.promptAssembly = "一只 { ears } 角色，{accessory}";
    }
    const r = validateLessonConfig(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("malformed token text"))).toBe(true);
  });

  it("rejects brand-style vocabulary in promptAssembly (scene content only — brand-style.md)", () => {
    const bad = clone(lesson001);
    const dialogue = bad.stages[2]!.variants!.find((v) => v.id === "dialogue")!;
    if (dialogue.interaction.type === "structured_qa") {
      dialogue.interaction.promptAssembly = "一只 {ears} 角色，水彩画风";
    }
    const r = validateLessonConfig(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("brand-style language"))).toBe(true);
  });
});

describe("episodicMemory placement (agent-context.md: STAGE-scoped, fail closed)", () => {
  it("accepts episodicMemory on a stage (lesson-001 talent declares it)", () => {
    expect(validateLessonConfig(lesson001).ok).toBe(true);
  });

  it("rejects episodicMemory on an interaction — zod would silently strip it (the forbidden silent fallback)", () => {
    const bad = JSON.parse(JSON.stringify(lesson001)) as { stages: { stageId: string; interaction?: Record<string, unknown> }[] };
    const talent = bad.stages.find((s) => s.stageId === "talent")!;
    talent.interaction!.episodicMemory = true;
    const r = validateLessonConfig(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("STAGE-scoped"))).toBe(true);
  });
});
