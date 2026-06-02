/**
 * @genius-x/ai-gateway — single entry point for all AI calls. SKELETON.
 *
 * Planned internal layers (see docs/contracts/ai-gateway.md and PRD §5.2):
 *   request-builder → safety-filter (input) → token-budget → provider-router
 *     → safety-filter (output) → fallback (on fail/timeout/filtered) → audit-logger
 *
 * Capability surface to implement: llm(), tts(), asr(), imageGen() — each behind the
 * same safety/budget/routing/fallback pipeline, routing among `ProviderAdapter`s.
 */
export type {
  ProviderAdapter,
  LlmRequest,
  TtsRequest,
  AsrRequest,
  ImageGenRequest,
  ImageJob,
  ImagePollResult,
  FakeBehavior,
  FakeProviderConfig,
} from "./providers/types";
export { FakeProvider } from "./providers/fake";
