/**
 * @genius-x/ai-gateway — single entry point for all AI calls.
 * M2a: gateway core (capabilities + safety + budget + routing + fallback + audit) on fake
 * providers. Real Tencent adapters + 天御 moderation, and the interaction wiring (M2b), follow.
 */
export { AiGateway } from "./gateway";
export type { GatewayDeps, ExtractMemoryRequest } from "./gateway";
export { KeywordSafetyFilter } from "./safety";
export type { SafetyFilter } from "./safety";
export { PresetFallbackLibrary } from "./fallback";
export type { FallbackLibrary } from "./fallback";
export { BRAND_STYLE_V0 } from "./brand-style";
export { FakeProvider } from "./providers/fake";
export type { FakeContent } from "./providers/fake";
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
