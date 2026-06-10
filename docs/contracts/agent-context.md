# Agent Context Contract (Phase 4)

**Status**: Frozen v1 (implementation: Phase 4 Steps 2–5; the safety-parity and budget
rules bind any earlier change that touches their surfaces)
**Owner**: Agent service (Agent I) · context builder in `apps/server/src/agent`;
gateway extensions owned by Agent D
**Typed realization**: `packages/contracts/src/agent-context.ts` (buffer entry, episode
schema bounds, reserved key, safety status)
**Phase**: Phase 4 — agent service with memory (scope per
[`../product/ip-character-concept-decisions.md`](../product/ip-character-concept-decisions.md))
**Companion contracts**: [`workspace.md`](workspace.md) (cold-path source),
[`ip-character.md`](ip-character.md) (canon injection), [`brand-style.md`](brand-style.md),
[`data-and-privacy.md`](data-and-privacy.md)
**Last updated**: 2026-06-09

---

## Purpose

Make the companion **coherent**: within a scene ("rounds form running context" — the child's
last utterances shape the next reply) and across lessons (the friend remembers who it is and
what the child shared). Today every AI call is stateless (`LlmRequest = {promptVersion,
input}` — proven in the 2026-06-09 audit); this contract defines the two context paths that
fix that, plus the safety and budget rules that make open-ended creation operable.

**Design principle P1 (AI-first)** applies throughout: open-ended content is validated by
**schema/format**, never by closed vocabularies; closed vocabularies remain only where they
are a deliberate quality/safety control (semantic memory slots).

---

## The two context paths (explicitly different — never merge them)

| | HOT — in-scene turn buffer | COLD — cross-lesson retrieval |
| --- | --- | --- |
| What | Last N rounds of THIS student's THIS-scene conversation, content-carrying (`{role: "child" \| "companion", text}`) | Persistent memories (semantic + episodic), IP character canon, recent-work summaries |
| Source of truth | Session-store tier (Redis/in-memory beside `ClassSession`) — **NOT the workspace** (classroom writes there are fire-and-forget ⇒ racy for synchronous reads). **This tier does not exist yet**: Phase 4 Step 2 adds a keyed `TurnBufferStore` interface beside `SessionStore` (in-memory + Redis impls) — NOT a `ClassSession` field, NOT a workspace table | Workspace (Phase 2 tables) + IP character record |
| Availability class | CORE for coherence, classroom-tier: lives where the session lives, works when the workspace is down | SHADOW: workspace down ⇒ cold context absent, **traced**, lesson continues |
| Failure mode | Buffer read/write fails ⇒ the call proceeds **stateless** (`context_degraded` trace; child sees a normal reply) | Retrieval fails ⇒ hot-only context (`context_cold_miss` trace) |
| Lifetime | Per (sessionId, studentId, sceneId); TTL = session retention; **cleared on scene exit** after consolidation | Permanent (workspace retention rules) |

**Scene key (Phase 4)**: `scene == stage` — `(sessionId, studentId, stageId)` is the buffer
key. A future `sceneId` (one stage hosting several scenes) is an additive, nullable field on
`InteractionContext` and this key; declared here so Phase 5's `scene.md` extends rather than
breaks this contract.

### Turn buffer rules (hot path)

- **Bounded**: max `TURN_BUFFER_MAX_ROUNDS` (default 8) rounds AND max
  `TURN_BUFFER_MAX_BYTES` (default 16 KB) per buffer; oldest evicted first. Both
  operator-configurable per deployment, never per child.
- **NEVER inside `ClassSession`**: the buffer must not ride `RESUME_STATE` or any
  client-bound message — raw child utterances do not ship to any client (privacy: the
  parent DENY list already bans transcripts; the child client never needs them either). A
  serialization test pins that `RESUME_STATE` carries no turn-buffer content.
- Writes happen in the interaction runner after ASR (child turn) and after the reply
  (companion turn); rounds whose **input was safety-filtered are not buffered** (see Safety
  parity below). A round whose OUTPUT was filtered buffers the **served fallback text**
  (what the child actually heard — the buffer is the conversation as experienced, never
  the filtered content). **Image rounds** (image_gen/doodle exchanges) are OUT of buffer
  scope in Phase 4 — they carry no conversational text; their buffering semantics (e.g.
  the assembled scene prompt as a companion turn) are defined by Phase 5's `scene.md`.
- Buffer content is ephemeral runtime data: it is NOT a record (the workspace
  `InteractionRecord` remains the persistent transcript); deleting a buffer loses no
  contractual data.

### Gateway extension (owned by D)

`LlmRequest` gains an optional, backward-compatible field:

```ts
history?: { role: "child" | "companion"; text: string }[]  // newest last, pre-bounded
```

- Absent/empty ⇒ exactly today's stateless behavior (fakes and all existing call sites
  unchanged).
- The gateway treats `history` as INPUT for safety purposes: it was already
  input-reviewed when buffered; the gateway re-reviews only the current `input`.
- Providers that cannot carry history degrade to stateless **with a trace**
  (`history_unsupported`) — operator-visible, never silent.

### Cold-path retrieval rules

Assembled per call (or per scene entry, cached in the buffer entry — implementation's
choice; semantics identical):

1. **Canon first** (always, smallest): the current IP character (base + surface) from
   [`ip-character.md`](ip-character.md). Canon is injected into EVERY context build and is
   exempt from any decay/forgetting — the friend never forgets who it is.
2. **Semantic memories**: latest-per-key dedup (DF-v2-15 — duplicate rows are
   contract-accepted in storage; the READER dedups), importance-ranked, top K (default 12).
3. **Episodic memories**: recency + importance ranked, top K (default 3) summaries.
4. Retrieval **writes back** `lastAccessedAt`/`accessCount` (fields pre-built in Phase 2),
   fire-and-forget.

Prompt assembly from these parts is a versioned prompt contract (`context_v1`) per the
existing PROMPT_CONTRACT discipline — context injection is a model-input contract, not
string concatenation scattered in the controller.

---

## Episodic memory (the AI-first carve-out)

The closed `declaredMemoryKeys` vocabulary stays for **semantic slots** (a deliberate
quality/safety control). Open-ended creation gets a new memory KIND validated by schema:

| Property | Rule |
| --- | --- |
| Reserved kind | `key = "episode"` — a RESERVED key, never in `declaredMemoryKeys` (validator rejects a lesson declaring it); the three-layer key check carves out exactly this value |
| Shape | `value` = JSON `{ summary: string (≤ 500 chars), tags: string[] (≤ 5, each ≤ 20 chars) }` — schema-validated at the gateway AND the workspace boundary; oversize ⇒ rejected with trace, never truncated silently |
| Producer | End-of-scene **consolidation**: when a scene exits (stage transition), the agent service summarizes that scene's buffer into ONE episodic memory via `gateway.extractEpisode` (new capability, same input-safety → call → schema-validate → output-safety pipeline as `llm`) |
| Trigger config | **Stage-scoped** (matching the consolidation trigger): `StageConfig` gains optional `episodicMemory?: boolean`; the existing per-interaction `memoryExtraction: boolean` stays interaction-level for semantic keys, unchanged. The validator rejects `episodicMemory` on an interaction (wrong scope, fail closed) |
| Failure | Consolidation is fire-and-forget: failure = `episode_consolidation_failed` trace; the scene/lesson is never blocked; the buffer is still cleared. Consolidation fires for a WHOLE class at a stage transition (20–30 calls): the calls flow through the same gateway concurrency/queueing floor as image bursts — fire-and-forget, so queue delay is invisible to the child by construction |
| Consumer | Cold-path retrieval (above); Phase 6 parent surfaces MAY show curated episode summaries — **never** raw buffer/transcripts (parent DENY list unchanged) |
| Privacy posture | The episode is a **curated summary**, not verbatim speech. Verbatim child utterances live only in `InteractionRecord` (operator-tier). Founder decision pending on parent visibility of episodes (`docs/architecture/scalable-architecture-v2.md` §14.1, referenced from workspace.md Scope) — until decided, episodes are NOT parent-served (pinned in parent-share.md v1.2 DENY list) |

---

## Safety parity (binds immediately — audit holes)

1. **`extractMemory` output review**: the mined `value` MUST pass `safety.reviewOutput`
   before being returned/persisted (today it skips it — the one path where model text
   reaches a child-visible surface unreviewed). Same rule for `extractEpisode`.
2. **Filtered rounds never become context**: an exchange whose input was safety-filtered is
   excluded from the turn buffer and from consolidation input.
3. **`InteractionRecord.safety` flag** (additive workspace column, Phase 4 migration):
   `"ok" | "input_filtered" | "output_filtered"` — so any future reader (context building,
   parent curation, analytics) can exclude or re-review flagged rows. Default `"ok"` for
   existing rows.
4. **Image-input review** (IMPLEMENTED, P4 Step 1b): the gateway runs
   `safety.reviewInput` on every **text2img source** before brand-suffixing and submitting
   (filtered ⇒ preset fallback images + `safety` trace — the child still gets a positive
   output). img2img sources are refs, not prose (no input review point; the post-generation
   `imageModerator` seam covers outputs). Defined in [`brand-style.md`](brand-style.md)
   §Pre-submit input review. Layered with the controller's answers-must-be-declared-options
   rule (client free text never reaches the prompt at all).

---

## Budget & concurrency (operational floor — owned by D, traced like everything else)

Per founder decision ⑥ (premium posture): **counters, not hard limits** — but counters are
mandatory (visible ≠ limited; an invisible cost is a silent normal path).

- `scene_round_count` / `scene_token_estimate` per (student, scene) — emitted as traces at
  scene exit; round caps from lesson config (`maxTurns`/`maxInteractions`) are ENFORCED
  server-side as deny-with-trace, with the child-facing cap experience designed per
  decision ⑦ default (the friend warmly wraps up — never a dead button). 
- Per-class concurrency gate for image generation (class-wide unlock synchronizes 20-30
  children into one burst): a queue inside the gateway; queue wait is dressed as thinking.
  Implementation: Phase 4 operational-floor step (DF-v2-19).

---

## Owner matrix

| Field/Seam | Owner | Source of truth | Allowed values | Derivation | Consumers | Fallback | Deletion | Preflight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Turn buffer entry | Agent service (I) | session-store tier, key `(sessionId, studentId, stageId)` | bounded `{role, text}[]` | written by interaction runner | context builder | absent ⇒ stateless call, traced | scene exit (post-consolidation) or session TTL | RESUME_STATE serialization test (no buffer content) |
| `LlmRequest.history` | Gateway (D) | per-call | bounded array | from turn buffer | provider adapters | absent ⇒ stateless | n/a | fakes pass unchanged (back-compat test) |
| `key="episode"` memories | Agent service (I) writes via workspace (H) | `memories` table (model type `StudentMemory`; carve-out in workspace.md v1.1) | schema-bound JSON value | end-of-scene consolidation | cold retrieval; parent: DENIED pending decision (parent-share.md v1.2) | extraction fail ⇒ no episode, traced | workspace retention | validator rejects lessons declaring `episode` (**implemented**, validate.ts); schema test at both boundaries (Phase 4) |
| `InteractionRecord.safety` | Workspace (H) | `interactions` column | `ok\|input_filtered\|output_filtered` | set at record time | context builder, curation | default `ok` | with row | migration backfills `ok` |
| Canon injection | Agent service (I) | `ip-character.md` record | see ip-character.md | read per context build | every contextual LLM call | absent ⇒ no canon block, traced `context_canon_miss` | never decays | ip-character preflights |
| Round-cap enforcement | Course runtime (C) | lesson config | declared caps | `interactionCounts` vs config | INTERACT path | cap ⇒ deny-with-trace + warm client UX | n/a | config caps > 0 validated |

---

## Failure modes (the classroom never blocks)

| Scenario | Behavior |
| --- | --- |
| Turn buffer store down | Calls proceed stateless; `context_degraded` traces counted; child experience: normal replies (less coherent — operator knows) |
| Workspace down | Hot context unaffected; cold context absent (`context_cold_miss` traced); friend is coherent in-scene but "forgetful" across lessons — operator-visible |
| Consolidation fails | Episode lost, traced; buffer still cleared; nothing user-visible |
| extractMemory/Episode output filtered | No memory persisted; `safety` trace; child unaffected |
| History too large for provider | Gateway truncates oldest-first to provider limit, traces `history_truncated` |

---

## Validation & preflight

- RESUME_STATE serialization test (concrete, not key-absence): drive a buffered
  conversation containing a distinctive marker string; assert the marker appears in
  NEITHER the serialized `ClassSession` (store snapshot) NOR any
  `RESUME_STATE`/`AI_OUTPUT` payload — pins the architectural separation, not just a
  field name.
- Back-compat: all existing gateway tests pass with `history` absent.
- Episode schema test at gateway AND workspace boundaries; validator test: lesson declaring
  `episode` in `declaredMemoryKeys` fails closed.
- `extractMemory` output-review test (filtered value ⇒ `{key:null}` + safety trace).
- Cap-enforcement test: round N+1 past `maxInteractions` ⇒ denied server-side with trace.

---

## Changelog

- **v1** (2026-06-09): initial freeze — hot/cold split, turn-buffer rules, `LlmRequest.history`,
  episodic memory kind, safety parity, budget/concurrency floor.

_Agent Context Contract · Phase 4 · Frozen v1 · 2026-06-09_
