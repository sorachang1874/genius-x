/**
 * Wire-shape validation for the Identity HTTP API (Phase 1, Step 4) — zod twins of the
 * frozen request types in @genius-x/contracts (enrollment.ts).
 *
 * LAYERING (deliberate): these schemas validate STRUCTURE only — unknown keys (strict
 * objects), missing fields, wrong primitive types → 400 INVALID_INPUT at the route.
 * SEMANTIC rules live in IdentityService so every caller gets them with the RIGHT error
 * code: age range → INVALID_AGE, dataRetentionAgreed !== true → CONSENT_REQUIRED,
 * consent-version format / blank name / non-UUID ids → INVALID_INPUT. Duplicating those
 * here would misreport their contract error codes as generic schema failures.
 *
 * strictObject everywhere: a typo'd field fails loudly (fail-closed), and for
 * UpdateStudentRequest the contract REQUIRES rejecting keys outside the allowlist —
 * that is the parent-privilege boundary (no geniusX/progress through the parent API).
 * This applies to QUERY strings too (deliberate): unknown query params and an empty
 * `?limit=` (coerces to 0) both 400 — pinned by route tests; fail-closed over lenient.
 */
import { z } from "zod";
// NOTE: no `satisfies z.ZodType<...>` anchors here — exactOptionalPropertyTypes makes zod's
// `.optional()` (`string | undefined`) incompatible with the contracts' `field?: string`
// (same constraint documented in engine/validate.ts). Drift is caught instead by the
// identity route tests asserting parsed output against the frozen request types.

const consentInputSchema = z.strictObject({
  consentVersion: z.string(),
  dataRetentionAgreed: z.boolean(),
  parentCoWorkAllowed: z.boolean().optional(),
  mediaUsageAllowed: z.boolean().optional(),
});

export const createParentRequestSchema = z.strictObject({
  tenantId: z.string(),
  wechatOpenId: z.string().optional(),
  phoneNumber: z.string().optional(),
});

export const enrollStudentRequestSchema = z.strictObject({
  parentId: z.string(),
  displayName: z.string(),
  age: z.number(),
  consent: consentInputSchema,
});

/** Allowlist boundary: strict — geniusX/progress (server-owned) are rejected here. */
export const updateStudentRequestSchema = z.strictObject({
  displayName: z.string().optional(),
  age: z.number().optional(),
});

export const updateConsentRequestSchema = consentInputSchema;

/** Query strings arrive as strings — coerce limit; service clamps/validates the value. */
export const listTenantStudentsQuerySchema = z.strictObject({
  limit: z.coerce.number().optional(),
  cursor: z.string().optional(),
});
