/**
 * @genius-x/contracts — single source of truth for shared semantics.
 *
 * This is a SKELETON. Types below are placeholders to mark structure; fill them in
 * contract-first (define the owner matrix in `docs/contracts/` before relying on a field).
 *
 * Planned modules (split into separate files as they grow):
 *   - course-config.ts     course JSON schema (stages, durations, unlock, aiInteraction)
 *   - api.ts               HTTP request/response types
 *   - ws-events.ts         ServerMessage / ClientMessage classroom-sync unions
 *   - ai-response.ts       validated AI gateway output schemas
 *   - state-machine.ts     stage transition events
 *   - enums.ts             StageId, Role, ArtifactType, MemoryKey
 *   - errors.ts            stable error code registry
 *   - migrations.ts        version + migration rules
 */

// --- Shared enums (placeholder — see docs/product/genius-x-mvp-prd.md §4.1) ---
export type StageId =
  | "standby"
  | "intro"
  | "icebreak"
  | "shape"
  | "talent"
  | "birth"
  | "closure";

export type Role = "student" | "assistant" | "teacher" | "parent";

// TODO(contracts): replace placeholders with real schemas, validated at the gateway
// and asserted by a fast contract preflight (see docs/contracts/).
export {};
