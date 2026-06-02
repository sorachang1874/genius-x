/**
 * Session-level validation before resume (Codex finding 4 / C-M1c). The config validator
 * (engine/validate.ts) checks the lesson; this checks a persisted session AGAINST the loaded
 * lesson. Fail closed on mismatch (RESUME_VERSION_MISMATCH) rather than resuming wrong state.
 */
import type { ClassSession, LessonConfig } from "@genius-x/contracts";

export function validateClassSessionForLesson(
  session: ClassSession,
  lesson: LessonConfig,
): string[] {
  const errors: string[] = [];
  if (session.lessonId !== lesson.lessonId) {
    errors.push(`session lessonId "${session.lessonId}" != loaded "${lesson.lessonId}"`);
  }
  if (session.lessonConfigVersion !== lesson.lessonConfigVersion) {
    errors.push(
      `RESUME_VERSION_MISMATCH: session ${session.lessonConfigVersion} != config ${lesson.lessonConfigVersion}`,
    );
  }
  if (!lesson.stages.some((s) => s.stageId === session.currentStageId)) {
    errors.push(`currentStageId "${session.currentStageId}" not in loaded lesson`);
  }
  return errors;
}
