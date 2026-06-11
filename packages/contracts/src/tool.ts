/**
 * Tool registry — typed realization of docs/contracts/tool.md (Phase 5).
 *
 * Tools are IN-SCENE CREATION INSTRUMENTS (the 2026-06-09 realignment), NOT a free
 * discovery marketplace. BINDING rules (lead-serialized narrowings of the v2 sketch):
 *   - mechanics are a CLOSED gateway-bound enum — no tool can name an endpoint/provider
 *   - tool style options compose WITHIN the brand contract (gateway-enforced)
 *   - inputs are declared option ids + same-student refs — never free text into prompts
 *   - childName is child-facing copy (banned-wording rule applies); toolId never renders
 */

/** The CLOSED set of gateway-bound mechanics a tool may use. */
export type ToolMechanic = "image_create" | "image_refine" | "story_chat";

/** A child-pickable variation — the ONLY tool input besides refs. */
export interface ToolOption {
  id: string; // tokenizable internal id
  label: string; // child-facing copy (banned-wording bound)
  /** SCENE-content prompt fragment (brand-style.md: never brand language). */
  promptFragment: string;
}

/** Versioned git-registry tool definition (validated fail-closed at boot). */
export interface ToolDefinition {
  toolId: string; // opaque internal id (never child-rendered)
  version: string; // traced on every invocation, like promptVersion
  childName: string; // child-facing copy
  mechanic: ToolMechanic;
  options?: ToolOption[];
}
