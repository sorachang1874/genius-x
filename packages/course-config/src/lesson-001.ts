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
  lessonConfigVersion: "1.3.0", // 1.3.0: promptAssembly carries SCENE content only — the brand style suffix moved to the gateway-level brand contract (docs/contracts/brand-style.md). OPS: bumping this fails-closed ALL persisted sessions on every message (guardSession) — deploy outside class hours; flush/reseed Redis sessions.
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
    "personality_tag", // the one 性格标签 (contracts-v1.4)
    "background_setting", // from shape B-line or talent (contracts-v1.4)
  ],
  declaredArtifactTypes: ["birth_certificate", "avatar_image"],
  certificate: {
    memoryLabels: {
      personality_tag: "性格",
      favorite_toy: "最喜欢的玩具",
      favorite_animal: "最喜欢的动物",
      best_friend: "最好的朋友",
      favorite_color: "最喜欢的颜色",
      favorite_food: "最喜欢的食物",
      background_setting: "故事背景",
      preferred_name: "喜欢的称呼",
    },
    order: [
      "personality_tag",
      "favorite_toy",
      "favorite_animal",
      "best_friend",
      "favorite_color",
      "favorite_food",
      "background_setting",
      "preferred_name",
    ],
  },
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
      output: "avatar_image", // Phase 2: the chosen avatar becomes a workspace Work
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
              // NOTE: "nose" is deliberately unreferenced by promptAssembly (pre-existing;
              // the dialogue beat matters, the image doesn't render noses well) — keep the
              // omission a conscious lesson-author choice, not an accident.
              { id: "nose", text: "我的鼻子要长一点还是小一点？", options: ["长鼻", "小鼻"] },
              { id: "accessory", text: "我想带一个配饰，是帽子还是眼镜？", options: ["帽子", "眼镜"] },
              { id: "background", text: "我身后的背景是大森林还是太空？", options: ["森林", "太空"] },
            ],
            // SCENE content only (brand-style.md): the brand style suffix is injected by
            // the AI gateway — no lesson config may carry brand-style language.
            promptAssembly: "一只可爱的 {ears} 卡通动物角色，{accessory}，{background}背景",
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
      interaction: { type: "birth_speech", promptTemplate: "birth_speech_v1", outputKind: "audio" },
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
