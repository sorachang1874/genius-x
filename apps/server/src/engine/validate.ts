/**
 * Runtime LessonConfig validator (the runtime twin of the `tsc` preflight). Validates a
 * loaded config (git or CMS) against the schema AND the lesson's own `declared*` ids, then
 * fails closed. The two no-optional schemas are annotated against the frozen contract types
 * (so they can't drift); the rest are inferred (exactOptionalPropertyTypes makes a full
 * z.ZodType<T> annotation impractical) and the result is asserted to `LessonConfig`.
 */
import { z } from "zod";
import type { StudentPredicate, AdvanceCondition, LessonConfig } from "@genius-x/contracts";

const studentPredicate: z.ZodType<StudentPredicate> = z.union([
  z.object({ kind: z.literal("stageStatus"), is: z.enum(["waiting", "in_progress", "completed"]) }),
  z.object({ kind: z.literal("minInteractions"), count: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("outputSet"), output: z.string() }),
  z.object({ kind: z.literal("variantSelected") }),
]);

const advanceCondition: z.ZodType<AdvanceCondition> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("immediate") }),
    z.object({ type: z.literal("allStudents"), of: studentPredicate }),
    z.object({ type: z.literal("countStudents"), min: z.number().int().positive(), of: studentPredicate }),
    z.object({ type: z.literal("all"), conditions: z.array(advanceCondition).min(1) }),
    z.object({ type: z.literal("any"), conditions: z.array(advanceCondition).min(1) }),
  ]),
);

const aiInteraction = z.union([
  z.object({
    type: z.literal("voice_chat"),
    promptTemplate: z.string(),
    maxTurns: z.number().int().positive(),
    thinkingAnimation: z.string().optional(),
  }),
  z.object({ type: z.literal("image_gen"), model: z.string(), outputCount: z.number().int().positive() }),
  z.object({
    type: z.literal("structured_qa"),
    promptTemplate: z.string(),
    questions: z.array(z.object({ id: z.string(), text: z.string(), options: z.array(z.string()) })),
    promptAssembly: z.string().optional(),
  }),
  z.object({
    type: z.literal("multimodal_talent"),
    promptTemplate: z.string(),
    options: z.array(z.string()),
    minInteractions: z.number().int().nonnegative(),
    maxInteractions: z.number().int().positive(),
    memoryExtraction: z.boolean(),
  }),
  z.object({ type: z.literal("birth_speech"), promptTemplate: z.string() }),
]);

const stageVariant = z.object({
  id: z.string(),
  label: z.string().optional(),
  interaction: aiInteraction,
  writesOutputs: z.array(z.string()).optional(),
});

const stageConfig = z.object({
  stageId: z.string(),
  name: z.string(),
  duration: z.number().nonnegative(),
  unlock: z.enum(["teacher", "assistant"]),
  advanceCondition,
  variants: z.array(stageVariant).min(1).optional(),
  interaction: aiInteraction.optional(),
  appState: z
    .object({
      displayText: z.string().optional(),
      avatarState: z.string().optional(),
      startButtonLocked: z.boolean().optional(),
      displayMode: z.string().optional(),
    })
    .optional(),
  output: z.string().optional(),
});

const lessonConfig = z.object({
  lessonId: z.string(),
  lessonTitle: z.string(),
  lessonConfigVersion: z.string(),
  totalDuration: z.number().positive(),
  unlockPolicy: z.literal("classWide"),
  declaredOutputs: z.array(z.string()),
  declaredMemoryKeys: z.array(z.string()),
  declaredArtifactTypes: z.array(z.string()),
  stages: z.array(stageConfig).min(1),
});

export type ValidationResult =
  | { ok: true; lesson: LessonConfig }
  | { ok: false; errors: string[] };

/** Collect every `outputSet` output referenced anywhere in a condition tree. */
function outputRefs(c: AdvanceCondition, acc: string[]): void {
  switch (c.type) {
    case "immediate":
      return;
    case "allStudents":
    case "countStudents":
      if (c.of.kind === "outputSet") acc.push(c.of.output);
      return;
    case "all":
    case "any":
      c.conditions.forEach((cc) => outputRefs(cc, acc));
      return;
  }
}

/** Validate shape + cross-references against the lesson's own declarations. Fails closed. */
export function validateLessonConfig(raw: unknown): ValidationResult {
  const parsed = lessonConfig.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const lesson = parsed.data;
  const errors: string[] = [];
  const outputs = new Set(lesson.declaredOutputs);
  const artifacts = new Set(lesson.declaredArtifactTypes);

  const seen = new Set<string>();
  for (const st of lesson.stages) {
    if (seen.has(st.stageId)) errors.push(`duplicate stageId "${st.stageId}"`);
    seen.add(st.stageId);

    const refs: string[] = [];
    outputRefs(st.advanceCondition, refs);
    for (const o of refs) {
      if (!outputs.has(o)) errors.push(`stage "${st.stageId}" advanceCondition references undeclared output "${o}"`);
    }
    for (const v of st.variants ?? []) {
      for (const o of v.writesOutputs ?? []) {
        if (!outputs.has(o)) errors.push(`stage "${st.stageId}" variant "${v.id}" writes undeclared output "${o}"`);
      }
    }
    if (st.output !== undefined && !artifacts.has(st.output)) {
      errors.push(`stage "${st.stageId}" output "${st.output}" not in declaredArtifactTypes`);
    }
    const hasVariants = (st.variants?.length ?? 0) > 0;
    const hasAppState = st.appState !== undefined && Object.keys(st.appState).length > 0;
    if (!hasVariants && !st.interaction && !hasAppState) {
      errors.push(`stage "${st.stageId}" is a no-op (no interaction, variants, or appState)`);
    }
  }

  // NOTE: session-level checks (currentStageId ∈ lesson, lessonConfigVersion match) belong to
  // resume (C-M1c, validateClassSessionForLesson). Unreachable-stage is moot for a linear
  // sequence; it returns when stage graphs land (out of scope v1).
  return errors.length > 0 ? { ok: false, errors } : { ok: true, lesson: lesson as LessonConfig };
}
