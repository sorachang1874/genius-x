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

/**
 * Phase 5 (scene.md): a stage's ALLOWED SUCCESSORS — declared `next` when present
 * (the teacher selects among them in class), else the linear implicit successor.
 * `[]` = terminal. Every existing linear lesson is unchanged.
 */
export function allowedSuccessors(lesson: LessonConfig, current: StageId): StageId[] {
  const st = stageById(lesson, current);
  if (!st) return [];
  if (st.next !== undefined) return st.next;
  const linear = nextStageId(lesson, current);
  return linear === null ? [] : [linear];
}

/** The lesson's TERMINAL stage (computed successors empty). Validator enforces exactly one. */
export function terminalStageId(lesson: LessonConfig): StageId {
  const terminals = lesson.stages.filter((st) => allowedSuccessors(lesson, st.stageId).length === 0);
  // validateLessonConfig guarantees exactly one — the fallback keeps pre-validation
  // callers (tests constructing raw configs) on the legacy last-stage semantics.
  return terminals.length === 1 ? terminals[0]!.stageId : lesson.stages[lesson.stages.length - 1]!.stageId;
}
