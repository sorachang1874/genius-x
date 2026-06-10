/**
 * Runtime LessonConfig validator (the runtime twin of the `tsc` preflight). Validates a
 * loaded config (git or CMS) against the schema AND the lesson's own `declared*` ids, then
 * fails closed. The two no-optional schemas are annotated against the frozen contract types
 * (so they can't drift); the rest are inferred (exactOptionalPropertyTypes makes a full
 * z.ZodType<T> annotation impractical) and the result is asserted to `LessonConfig`.
 */
import { z } from "zod";
import type { StudentPredicate, AdvanceCondition, LessonConfig } from "@genius-x/contracts";
import { EPISODE_MEMORY_KEY, PROMPT_ASSEMBLY_TOKEN_RE } from "@genius-x/contracts";

/** Brand-style language is the GATEWAY's job (brand-style.md): the enumerated denylist a
 *  lesson's promptAssembly must not contain — scene content only, fail closed. */
const BRAND_STYLE_VOCABULARY_RE = /风格|色彩|插画|画风|水彩|像素/;

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
  z.object({
    type: z.literal("birth_speech"),
    promptTemplate: z.string(),
    outputKind: z.enum(["text", "audio", "images"]),
  }),
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
  certificate: z
    .object({
      memoryLabels: z.record(z.string(), z.string()),
      order: z.array(z.string()).optional(),
    })
    .optional(),
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
  const memoryKeys = new Set(lesson.declaredMemoryKeys);

  // agent-context.md: "episode" is the RESERVED schema-validated memory kind — a lesson
  // declaring it would let child-derived free values flow under the reserved key.
  if (memoryKeys.has(EPISODE_MEMORY_KEY)) {
    errors.push(`declaredMemoryKeys must not contain the reserved key "${EPISODE_MEMORY_KEY}" (agent-context.md)`);
  }

  // certificate labels/order must reference declared memory keys (fail closed — contracts-v1.4)
  for (const k of Object.keys(lesson.certificate?.memoryLabels ?? {})) {
    if (!memoryKeys.has(k)) errors.push(`certificate.memoryLabels references undeclared memory key "${k}"`);
  }
  for (const k of lesson.certificate?.order ?? []) {
    if (!memoryKeys.has(k)) errors.push(`certificate.order references undeclared memory key "${k}"`);
  }

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

    // brand-style.md preflights (fail closed — the same shared token regex the runtime
    // assembler uses, so validator and controller can never drift):
    //   1. template tokens must reference declared question ids;
    //   2. question ids must be TOKENIZABLE (ASCII word chars) when a template exists —
    //      a CJK/hyphenated id would never match a token, silently un-templating it;
    //   3. no residual braces after token extraction (malformed tokens like "{ ears }"
    //      would ship to the image provider as literal brace text);
    //   4. no brand-style vocabulary — scene content only, the brand suffix is gateway-injected.
    for (const i of [st.interaction, ...(st.variants ?? []).map((v) => v.interaction)]) {
      if (i?.type === "structured_qa" && i.promptAssembly !== undefined) {
        const ids = new Set(i.questions.map((q) => q.id));
        for (const m of i.promptAssembly.matchAll(PROMPT_ASSEMBLY_TOKEN_RE)) {
          if (!ids.has(m[1]!)) {
            errors.push(`stage "${st.stageId}" promptAssembly references unknown question id "${m[1]}"`);
          }
        }
        for (const q of i.questions) {
          if (!/^[A-Za-z0-9_]+$/.test(q.id)) {
            errors.push(`stage "${st.stageId}" question id "${q.id}" is not tokenizable (promptAssembly requires /^[A-Za-z0-9_]+$/ ids)`);
          }
        }
        const residue = i.promptAssembly.replace(PROMPT_ASSEMBLY_TOKEN_RE, "");
        if (/[{}]/.test(residue)) {
          errors.push(`stage "${st.stageId}" promptAssembly contains malformed token text (residual braces)`);
        }
        if (BRAND_STYLE_VOCABULARY_RE.test(i.promptAssembly)) {
          errors.push(`stage "${st.stageId}" promptAssembly contains brand-style language (brand-style.md: scene content only — the brand suffix is injected by the gateway)`);
        }
      }
    }
  }

  // NOTE: session-level checks (currentStageId ∈ lesson, lessonConfigVersion match) belong to
  // resume (C-M1c, validateClassSessionForLesson). Unreachable-stage is moot for a linear
  // sequence; it returns when stage graphs land (out of scope v1).
  return errors.length > 0 ? { ok: false, errors } : { ok: true, lesson: lesson as LessonConfig };
}
