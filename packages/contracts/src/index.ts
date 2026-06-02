/**
 * @genius-x/contracts — single source of truth for shared semantics.
 * contracts v1 — generic config-driven engine (git tag `contracts-v1`). Changes only via
 * lead re-serialization + independent review (see AGENTS.md, docs/agents/README.md).
 * docs/contracts/ holds the prose contracts; docs/architecture/lesson-runtime.md the engine.
 */
export * from "./enums.js";
export * from "./course-config.js";
export * from "./ws-events.js";
export * from "./api.js";
export * from "./engine.js";
export * from "./ai-response.js";
export * from "./student.js";
export * from "./errors.js";
