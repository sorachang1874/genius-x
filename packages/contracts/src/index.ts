/**
 * @genius-x/contracts — single source of truth for shared semantics.
 * contracts v0 (DRAFT, pending founder freeze). See docs/contracts/ for the prose
 * contracts (owner matrices, allowed values, deletion conditions, failure modes).
 *
 * Gate: this surface must be frozen before parallel agents (B-F) fan out.
 */
export * from "./enums.js";
export * from "./course-config.js";
export * from "./ws-events.js";
export * from "./ai-response.js";
export * from "./student.js";
export * from "./errors.js";
