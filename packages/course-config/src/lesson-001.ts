/**
 * Lesson 1 — 认识我的 AI 好朋友. Source: genius-x-lesson1-rundown.md, PRD §4.2, §7.
 *
 * Typed as LessonConfig → `tsc` is the contract preflight: if this stops conforming to the
 * frozen contract, typecheck fails. New lessons are added as data like this (later via
 * Payload CMS export), never by editing the engine.
 *
 * NOTE (tracked v0 gap): the shape stage here uses the A-line (doodle → image_gen) only —
 * the primary path that must run (D2). The B-line (structured dialogue → image) needs a
 * per-variant interaction shape the frozen contract does not yet model; that is a tracked
 * contract amendment (see NEXT_TODO) to apply via lead re-serialization before B-line lands.
 */
import type { LessonConfig } from "@genius-x/contracts";

export const lesson001: LessonConfig = {
  lessonId: "lesson-001",
  lessonTitle: "认识我的 AI 好朋友",
  totalDuration: 60,
  stages: [
    {
      stageId: "intro",
      name: "老师前情提要",
      duration: 6,
      unlockBy: "teacher",
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
      unlockBy: "assistant",
      aiInteraction: {
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
      unlockBy: "assistant",
      variants: ["drawing"], // B-line ("dialogue") added with the tracked contract amendment
      aiInteraction: {
        type: "image_gen",
        model: "image_gen_adapter", // provider-agnostic (D3)
        outputCount: 3,
      },
    },
    {
      stageId: "talent",
      name: "才艺互动",
      duration: 18,
      unlockBy: "assistant",
      aiInteraction: {
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
      unlockBy: "assistant",
      aiInteraction: {
        type: "birth_speech",
        promptTemplate: "birth_speech_v1",
      },
      output: "birth_certificate",
    },
    {
      stageId: "closure",
      name: "全班收束",
      duration: 3,
      unlockBy: "teacher",
      appState: {
        displayMode: "summary_with_certificate",
      },
    },
  ],
};
