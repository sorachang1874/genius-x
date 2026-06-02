/**
 * Stage resolution by id (NOT index++) — keeps branching open later.
 */
import type { LessonConfig, StageConfig, StageId } from "@genius-x/contracts";

export function stageById(lesson: LessonConfig, stageId: StageId): StageConfig | null {
  return lesson.stages.find((s) => s.stageId === stageId) ?? null;
}

export function stageIndex(lesson: LessonConfig, stageId: StageId): number {
  return lesson.stages.findIndex((s) => s.stageId === stageId);
}

/** The next stage's id, or null if `current` is unknown or terminal. */
export function nextStageId(lesson: LessonConfig, current: StageId): StageId | null {
  const i = stageIndex(lesson, current);
  if (i < 0 || i + 1 >= lesson.stages.length) return null;
  return lesson.stages[i + 1]!.stageId;
}
