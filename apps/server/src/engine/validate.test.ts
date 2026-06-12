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

  it("rejects a lesson declaring the RESERVED 'self_narrative' diary key (workspace.md v1.3 — else the extraction path could mint model-authored diary entries)", () => {
    const bad = clone(lesson001);
    bad.declaredMemoryKeys.push("self_narrative");
    const r = validateLessonConfig(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('reserved key "self_narrative"'))).toBe(true);
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

describe("scene graph + tool resolution (Phase 5: scene.md / tool.md preflights)", () => {
  const sceneLesson = (): LessonConfig => {
    const l = clone(lesson001);
    // a branching middle: shape may go to talent OR straight to birth
    l.stages[2]!.next = ["talent", "birth"];
    l.stages[3]!.next = ["birth"];
    return l;
  };

  it("accepts a branching scene library with exactly one reachable terminal", () => {
    expect(validateLessonConfig(sceneLesson()).ok).toBe(true);
  });

  it("rejects unknown next refs, multiple terminals, unreachable scenes, and dead ends", () => {
    const badRef = sceneLesson();
    badRef.stages[2]!.next = ["nope"];
    expect(validateLessonConfig(badRef).ok).toBe(false);

    const twoTerminals = clone(lesson001);
    twoTerminals.stages[2]!.next = []; // shape becomes a SECOND terminal
    const r2 = validateLessonConfig(twoTerminals);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors.some((e) => e.includes("exactly ONE terminal") || e.includes("cannot reach"))).toBe(true);

    const unreachable = sceneLesson();
    unreachable.stages[1]!.next = ["shape"]; // icebreak only → shape; but talent declared… still reachable via shape. Make one truly dead:
    unreachable.stages[0]!.next = ["shape"]; // intro skips icebreak entirely
    unreachable.stages[1]!.next = ["shape"];
    const r3 = validateLessonConfig(unreachable);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.errors.some((e) => e.includes("unreachable"))).toBe(true);
  });

  it("resolves declared tools against the registry; unknown tools and brand-vocab fragments fail closed", () => {
    const withTool = clone(lesson001);
    withTool.stages[2]!.tools = ["magic_brush"];
    expect(validateLessonConfig(withTool, [{ toolId: "magic_brush", version: "v1", childName: "魔法画笔", mechanic: "image_refine", options: [{ id: "hat", label: "戴帽子", promptFragment: "戴上一顶小帽子" }] }]).ok).toBe(true);

    const unknownTool = clone(lesson001);
    unknownTool.stages[2]!.tools = ["nope_tool"];
    expect(validateLessonConfig(unknownTool, []).ok).toBe(false);

    const brandFragment = clone(lesson001);
    brandFragment.stages[2]!.tools = ["bad_tool"];
    const r = validateLessonConfig(brandFragment, [{ toolId: "bad_tool", version: "v1", childName: "工具", mechanic: "image_refine", options: [{ id: "x", label: "水彩", promptFragment: "水彩画风的感觉" }] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("brand-style language"))).toBe(true);
  });
});

describe("tool child-facing copy (banned wording, fail closed)", () => {
  it("rejects a tool childName or option label carrying banned wording", () => {
    const l = clone(lesson001);
    l.stages[2]!.tools = ["ai_tool"];
    const r = validateLessonConfig(l, [{ toolId: "ai_tool", version: "v1", childName: "AI 画笔", mechanic: "image_refine", options: [] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes("banned child-facing wording"))).toBe(true);
    expect(validateLessonConfig(l, [{ toolId: "ai_tool", version: "v1", childName: "魔法画笔", mechanic: "image_refine", options: [{ id: "x", label: "大模型风", promptFragment: "x" }] }]).ok).toBe(false);
  });
});
