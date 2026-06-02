/**
 * Stable error code registry — contracts v0 (DRAFT, pending freeze).
 * Internal codes for logs/audit. NEVER surfaced to a child (no failure state, PRD §0):
 * the UI maps any error to a positive fallback, while ops sees the real code.
 */
export type ErrorCode =
  | "AI_TIMEOUT" // provider exceeded latency budget → fallback
  | "AI_FILTERED" // safety pipeline blocked output → fallback
  | "AI_PROVIDER_ERROR" // provider call failed → route/fallback
  | "BUDGET_EXCEEDED" // token/cost ceiling hit → truncate/fallback
  | "INVALID_LESSON_CONFIG" // lesson JSON failed schema validation → fail closed
  | "CONTRACT_VIOLATION" // AI output failed its schema → fallback
  | "SESSION_NOT_FOUND"
  | "STAGE_TRANSITION_DENIED"; // illegal stage transition attempted

export interface ErrorInfo {
  code: ErrorCode;
  /** Operator-facing detail. Never shown to a child. */
  detail: string;
  /** True if this error was absorbed by a fallback (operator-visible degradation). */
  degraded: boolean;
}
