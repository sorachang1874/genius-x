/**
 * Generic guard evaluators — drive advancement off declarative config, not stage names.
 * Exhaustive switches (`never`) so adding a condition/predicate type forces an update here.
 */
import type {
  AdvanceCondition,
  StudentPredicate,
  ClassSession,
  StudentRuntimeState,
  StageId,
} from "@genius-x/contracts";

export function evalStudentPredicate(
  p: StudentPredicate,
  s: StudentRuntimeState,
  stageId: StageId,
): boolean {
  switch (p.kind) {
    case "stageStatus":
      return s.stageStatus[stageId] === p.is;
    case "minInteractions":
      return (s.interactionCounts[stageId] ?? 0) >= p.count;
    case "outputSet":
      return s.outputs[p.output] !== undefined;
    case "variantSelected":
      return s.selectedVariant[stageId] !== undefined;
    default: {
      const _exhaustive: never = p;
      return _exhaustive;
    }
  }
}

export function evalAdvanceCondition(
  c: AdvanceCondition,
  session: ClassSession,
  stageId: StageId,
): boolean {
  const students = Object.values(session.students);
  switch (c.type) {
    case "immediate":
      return true;
    case "allStudents":
      // vacuously false for an empty class — never advance with no students present
      return students.length > 0 && students.every((s) => evalStudentPredicate(c.of, s, stageId));
    case "countStudents":
      return students.filter((s) => evalStudentPredicate(c.of, s, stageId)).length >= c.min;
    case "all":
      return c.conditions.every((cc) => evalAdvanceCondition(cc, session, stageId));
    case "any":
      return c.conditions.some((cc) => evalAdvanceCondition(cc, session, stageId));
    default: {
      const _exhaustive: never = c;
      return _exhaustive;
    }
  }
}
