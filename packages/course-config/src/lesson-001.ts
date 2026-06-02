/**
 * Lesson 1 — 认识我的 AI 好朋友. Instance #1 of the generic LessonConfig (contracts v1).
 * Source: genius-x-lesson1-rundown.md, PRD §4.2/§7. `tsc` is the contract preflight; a Zod
 * validator (engine, M1) is the runtime twin checking id references against the declarations.
 *
 * Shape now carries BOTH variants generically (A-line drawing / B-line dialogue) — the
 * previously-deferred C1 gap is resolved by the generic variant model, not a special case.
 */
import type { LessonConfig } from "@genius-x/contracts";

export const lesson001: LessonConfig = {
  lessonId: "lesson-001",
  lessonTitle: "认识我的 AI 好朋友",
  lessonConfigVersion: "1.0.0",
  totalDuration: 60,
  unlockPolicy: "classWide",
  declaredOutputs: ["avatarUrl"],
  declaredMemoryKeys: [
    "favorite_toy",
    "favorite_animal",
    "best_friend",
    "favorite_color",
    "favorite_food",
    "preferred_name",
  ],
  declaredArtifactTypes: ["birth_certificate"],
  stages: [
    {
      stageId: "intro",
      name: "老师前情提要",
      duration: 6,
      unlock: "teacher",
      advanceCondition: { type: "immediate" },
      appState: {
        displayText: "一个魔法泥人正在等你……",
        avatarState: "placeholder_clay",
        startButtonLocked: true,
      },
    },
    {
      stageId: "icebreak",
      name: "导入：语音破冰",
      duration: 8,
      unlock: "assistant",
      advanceCondition: { type: "immediate" },
      interaction: {
        type: "voice_chat",
        promptTemplate: "icebreak_v1",
        maxTurns: 3,
        thinkingAnimation: "bubble",
      },
    },
    {
      stageId: "shape",
      name: "塑形",
      duration: 13,
      unlock: "assistant",
      advanceCondition: {
        type: "allStudents",
        of: { kind: "outputSet", output: "avatarUrl" },
      },
      variants: [
        {
          id: "drawing", // A-line
          label: "涂鸦变身",
          interaction: { type: "image_gen", model: "image_gen_adapter", outputCount: 3 },
          writesOutputs: ["avatarUrl"],
        },
        {
          id: "dialogue", // B-line
          label: "对话捏脸",
          interaction: {
            type: "structured_qa",
            promptTemplate: "shape_dialogue_v1",
            questions: [
              { id: "ears", text: "我的耳朵应该是尖尖的还是圆圆的？", options: ["尖耳", "圆耳"] },
              { id: "nose", text: "我的鼻子要长一点还是小一点？", options: ["长鼻", "小鼻"] },
              { id: "accessory", text: "我想带一个配饰，是帽子还是眼镜？", options: ["帽子", "眼镜"] },
              { id: "background", text: "我身后的背景是大森林还是太空？", options: ["森林", "太空"] },
            ],
            promptAssembly:
              "一只可爱的 {ears} 卡通动物角色，{accessory}，{background}背景，儿童插画风格，鲜艳色彩，白色背景",
          },
          writesOutputs: ["avatarUrl"],
        },
      ],
    },
    {
      stageId: "talent",
      name: "才艺互动",
      duration: 18,
      unlock: "assistant",
      advanceCondition: {
        type: "allStudents",
        of: { kind: "minInteractions", count: 2 },
      },
      interaction: {
        type: "multimodal_talent",
        promptTemplate: "talent_v1",
        options: ["sing", "story", "question", "draw"],
        minInteractions: 2,
        maxInteractions: 3,
        memoryExtraction: true,
      },
    },
    {
      stageId: "birth",
      name: "诞生礼",
      duration: 12,
      unlock: "assistant",
      advanceCondition: {
        type: "allStudents",
        of: { kind: "stageStatus", is: "completed" },
      },
      interaction: { type: "birth_speech", promptTemplate: "birth_speech_v1" },
      output: "birth_certificate",
    },
    {
      stageId: "closure",
      name: "全班收束",
      duration: 3,
      unlock: "teacher",
      advanceCondition: { type: "immediate" },
      appState: { displayMode: "summary_with_certificate" },
    },
  ],
};
