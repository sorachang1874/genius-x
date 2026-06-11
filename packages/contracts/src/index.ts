/**
 * @genius-x/contracts — single source of truth for shared semantics.
 * contracts v1 — generic config-driven engine (git tag `contracts-v1`). Changes only via
 * lead re-serialization + independent review (see AGENTS.md, docs/agents/README.md).
 * docs/contracts/ holds the prose contracts; docs/architecture/lesson-runtime.md the engine.
 */
export * from "./enums";
export * from "./course-config";
export * from "./ws-events";
export * from "./api";
export * from "./engine";
export * from "./ai-response";
export * from "./student";
export * from "./errors";
// Phase 1 — persistent identity & enrollment (docs/contracts/identity.md, enrollment.md).
export * from "./identity";
export * from "./enrollment";
// Phase 2 — student workspace (docs/contracts/workspace.md).
export * from "./workspace";
export * from "./workspace-api";
// Phase 3 — parent read-only share artifact (docs/contracts/parent-share.md).
export * from "./parent-share";
// Phase 4 — agent context (docs/contracts/agent-context.md) + brand style (brand-style.md).
export * from "./agent-context";
export * from "./brand-style";
// Phase 4.5 — IP character entity (docs/contracts/ip-character.md).
export * from "./ip-character";
// Phase 5 — tool registry (docs/contracts/tool.md).
export * from "./tool";
// Phase 6 — authenticated parent surface (docs/contracts/parent-surface.md).
export * from "./parent-surface";
export * from "./theme";
export * from "./playground";
