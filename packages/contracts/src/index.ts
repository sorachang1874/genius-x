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
