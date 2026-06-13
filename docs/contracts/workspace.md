# Workspace Contract (Phase 2)

**Status**: Frozen v1.4 (v1.3 + the diary hardening rev — see Changelog)
**Owner**: Workspace Service (Agent H)
**Phase**: Phase 2 — Student workspace foundation
**Typed realization**: `packages/contracts/src/workspace.ts` + `workspace-api.ts`
**Companion contracts**: [`identity.md`](identity.md) (the Student the workspace belongs to),
[`data-and-privacy.md`](data-and-privacy.md) (retention/privacy rules this contract obeys),
[`agent-context.md`](agent-context.md) (Phase-4 reader + the `episode` carve-out below),
[`ip-character.md`](ip-character.md) (Phase-4.5 lineage fields below)
**Last updated**: 2026-06-09

---

## Purpose

The workspace is the child's **persistent creative portfolio**: works, interaction history,
and extracted memories. The Classroom Service writes it per stage (fire-and-forget); the
Phase-3 parent artifact and the Phase-4 agent read it. It is the bridge from "a class
happened" to "the companion remembers".

---

## Scope

In scope (Phase 2):
- `Work`, `InteractionRecord`, `StudentMemory` persistent models + PostgreSQL tables
- Server-internal writes from the classroom (per-stage; lesson-end certificate)
- READ API over HTTP (operator/admin posture — auth is Phase 3)

Out of scope (deferred):
- ❌ Real object storage (Tencent COS) — `contentUrl`/`contentRef` are opaque references;
  real upload/CDN lands with real providers (M6) / rich media (Phase 7). Refs may be
  FakeProvider placeholder URLs until then (operator-visible via `aiParams`).
- ❌ Parent-scoped filtered reads (Phase 3), parent/child writes (Phase 6)
- ❌ Importance scoring/decay + embeddings (Phase 4; fields exist, baseline 0.5)
- ❌ ToolUsage (Phase 5 — no tool registry exists)
- ❌ Memory privacy flags ("private to child") — open product decision (§14.1)

---

## Public interface

Models: see `workspace.ts` (authoritative). Key semantics:

| Aspect | Rule |
| --- | --- |
| `Work.type` | Opaque `ArtifactType`, must be in the lesson's `declaredArtifactTypes` (validated at write) — **divergence from architecture §2.2's closed enum, lead-serialized** (lesson-extensible per enums.ts philosophy) |
| Work content | At least one of `contentUrl`/`contentText`/`contentJson` present (no empty works) |
| `Work.contentJson` is **parent-visible by contract** | Phase 3 serves it verbatim in the share view ([parent-share.md](parent-share.md)) — writers must keep it free of operator metadata / internal ids; the share service deep-scrubs denied keys as defense-in-depth (traced) |
| `InteractionRecord.input` | REF or short text only — **raw audio/doodle bytes are never stored** (privacy contract) |
| `output.degraded` / `WorkMetadata.degraded` | Operator-visible end-to-end; parents/children never see it |
| `StudentMemory` | Persistent twin of the runtime memory; keys ∈ `declaredMemoryKeys`; importance baseline 0.5 (Phase 4 scores) |
| `tenantId` everywhere | Denormalized + DB-enforced (composite FK to `students(id, tenant_id)`) — a workspace row can never point across tenants |

### API (Phase 2 = reads only over HTTP)

| Method & path | Success | Notes |
| --- | --- | --- |
| `GET /students/:id/workspace` | `200 WorkspaceSummaryResponse` | counts + lastActivityAt; `404 STUDENT_NOT_FOUND` |
| `GET /students/:id/works?limit&cursor` | `200 ListWorksResponse` | recency-first keyset; clamp 20/100 |
| `GET /works/:id` | `200 Work` | `404 WORK_NOT_FOUND` |
| `GET /students/:id/interactions?limit&cursor` | `200 ListInteractionsResponse` | recency-first |
| `GET /students/:id/memories?limit&cursor` | `200 ListMemoriesResponse` | importance-first (`importance DESC, created_at DESC, id DESC` — the id tiebreak makes the keyset a total order) |

Errors: `WorkspaceErrorCode` (`STUDENT_NOT_FOUND`/`WORK_NOT_FOUND`/`INVALID_INPUT`) with the
mapped statuses; undefined failures = sanitized `500 INTERNAL` (enrollment.md v1.1 rule).
Strict query objects (unknown params → 400), same as the identity routes. All
`/students/:id/*` reads validate the student FIRST: unknown student ⇒ `404
STUDENT_NOT_FOUND`, never an empty page.

**Writes are server-internal** (`RecordWorkRequest`/`RecordInteractionRequest`/
`RecordMemoryRequest`): called in-process by the Classroom Service. NOT exposed over HTTP in
Phase 2 — the privilege boundary (same pattern as `StudentProgressUpdate`). Phase 6 adds
parent-initiated writes behind auth.

---

## Owner matrix

All fields new in v1 (Migration = new v1).

| Field | Owner | Source of truth | Allowed values | Derivation | Consumers | Fallback | Deletion condition | Preflight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Work.id` | Workspace Service | `works` table | UUID | generated on record | Parent artifact (P3), Agent (P4) | none | retention policy (lifetime+1y) | query by id returns row |
| `Work.type` | Lesson config | `works.type` | ∈ `declaredArtifactTypes` of `metadata.lessonId`'s lesson | classroom write | renderers per type | none — write rejected | with work | no row has a type outside its lesson's declared set |
| `Work.tenantId` | Workspace Service | `works.tenant_id` | = student's tenant | derived from student | isolation | none | with work | composite FK enforced |
| `Work.metadata.degraded` | Classroom Service | `works.degraded` | boolean | from gateway result | operators (quality audit) | none | with work | degraded works countable by query |
| `InteractionRecord.input.contentRef` | Classroom Service | `interactions.input_ref` | opaque ref, NEVER raw bytes | from wire input | Phase-4 agent context | none | retention policy | no value larger than a ref (length ≤ 512) |
| `InteractionRecord.context.initiatedBy` | Writer | `interactions.initiated_by` | `student` \| `parent` | classroom = student | Phase-6 co-work tagging, parent filters | none | with row | enum CHECK |
| `StudentMemory.key` | Lesson config | `memories.key` | ∈ `declaredMemoryKeys` **OR the reserved `"episode"` kind** (v1.1 carve-out, [`agent-context.md`](agent-context.md): schema-validated episodic memories; a lesson may never DECLARE `episode` — validator fails closed; the workspace write path accepts it only with a schema-valid `EpisodeValue` JSON value, Phase-4 implementation) | extraction; episode = end-of-scene consolidation | Agent (P4), parent summary (P3 — episodes NOT parent-served, see parent-share.md v1.2) | none — write rejected | importance decay (P4; episodes decay, CANON never — canon lives in ip-character.md, not here) / retention | no row with undeclared key for its lesson **excluding `key='episode'`** |
| `StudentMemory.importance` | Agent Service (P4); Phase 2 writes baseline | `memories.importance` | 0..1 | default 0.5 | retrieval ordering | none | decay archive (P4) | 0 ≤ x ≤ 1 CHECK |
| `*.createdAt/occurredAt` | Writer | table columns | ISO/timestamptz | classroom clock (`occurredAt`) vs DB clock (`createdAt`); `occurredAt` sanity-bounded (≥2024-01-01, ≤ createdAt+1d) | ordering, retention | none | with row | CHECK bounds |
| `InteractionRecord.output.workId` / `StudentMemory.context.sourceInteractionId` | Writer | FK columns | SAME-student row only (composite FK `(ptr, student_id)`) | classroom write | Phase-3 renders, Phase-4 context | none — write rejected | with row | cross-student pointer preflights below = 0 |
| `InteractionRecord.memoriesExtracted` | Workspace Service | `interactions.memories_extracted` | UUID[] (no NULLs, ≤64) | appended ATOMICALLY by `recordMemory` when `sourceInteractionId` is set and same-student | Phase-4 agent context | none | with row | LATERAL preflight below = 0 |
| `WorkspaceSummaryResponse.lastActivityAt` | Workspace Service | derived | ISO | `GREATEST(max(created_at))` across the three tables (DB clock, not occurredAt) | operator/parent dashboards | absent when empty | n/a | matches a manual MAX query |

---

## Lifecycle (who writes what, when)

1. **INTERACTION_DONE** (classroom): `recordInteraction` — input (ref/text; structured
   inputs as canonical JSON in `text`) + output (+ `degraded`), `occurredAt` = classroom
   clock. Fire-and-forget.
2. **Memory extraction success**: `recordMemory` (key/value); when the interaction's own
   workspace record id is known, it rides as `sourceInteractionId` and `recordMemory`
   ATOMICALLY appends the memory id into that interaction's `memoriesExtracted`
   (same-student only — a cross-student pointer is rejected, see owner matrix).
3. **Stage completion → artifact work** (REVISED v1.2, Phase 4.5 — decision ②/works
   lifecycle): a stage that declares `output: ArtifactType` produces ONE Work per
   completion **EVENT** — re-completions (in-scene refinement, the IP concept's normal
   creative path) each record their own immutable Work; the portfolio is the ITERATION
   HISTORY, newest = current. The former one-per-FIRST-completion rule (which kept the
   child's first draft and discarded refinements) is retired; the
   `workspace_work_stale_recomplete` divergence trace becomes `workspace_work_iteration`
   (countable iteration volume, not an anomaly). A transport-level duplicate redelivery of the SAME completion is still an EVENT — duplicates are absorbed by parent-side curation (latest-per-type) and stay countable via the iteration trace. **This rev ships in the SAME
   serialization as parent-share.md's curation rev — recording every iteration without
   curation rules floods the parent gallery.** Content derivation is per artifact type
   (the per-lesson declarative map is DF-v2-14): `avatar_image` → `contentUrl` = the
   student's `outputs["avatarUrl"]`; `birth_certificate` → `contentJson` below.
   Lesson-001 companion change: v1.2.0 adds `output: "avatar_image"` to the shape stage.
4. **Birth certificate** (the birth stage's `output`, recorded at ITS completion — not the
   final/closure stage, which declares no artifact): `contentJson` is the
   `BirthCertificate` shape from student.ts, memories mapped to `{label, value}[]` via the
   lesson's `certificate.memoryLabels`. PARTIAL certificates (missing avatar/speech/
   personality/background — real paths, e.g. mid-lesson joiners): recorded with `""`
   blanks AND `metadata.degraded = true` (operator-visible incomplete-content marker;
   renderers handle blanks warmly). A fully-populated certificate carries the speech's own
   degraded flag.
5. **Reads**: operator/admin over HTTP now; Phase 3 parent artifact consumes the same
   service with privacy filtering (works + summaries — never raw transcripts).

**Failure mode = never touches the classroom** (same discipline as the Phase-1 write-back):
every write is fire-and-forget; failures/skips are operator-visible traces
(`workspace_write_failed` / `workspace_write_skipped_*` — counted); workspace down ⇒
lesson proceeds, holes are operator-visible. Operator re-records are NOT deduplicated
(no client-mintable ids in Phase 2): a manual re-record creates a duplicate row — the
accepted recovery cost, visible in counts. The workspace service being absent (no
DATABASE_URL) is a loud deployment state, not a silent fallback.

---

## Failure modes

| Scenario | Behavior | Recovery |
| --- | --- | --- |
| Unknown student on read | `404 STUDENT_NOT_FOUND` | — |
| Unknown work | `404 WORK_NOT_FOUND` | — |
| Malformed id/cursor/limit | `400 INVALID_INPUT` | — |
| Write fails mid-class (DB blip) | Trace `workspace_write_failed` (code only, no PII); lesson unaffected | Operator re-records from session data if material; gaps visible in counts |
| Artifact type not declared by lesson | Write rejected + trace (`INVALID_INPUT`) | Lesson config fix |
| Workspace absent (no identity/db wired) | Loud skip trace per write batch | Deployment fix |

---

## Validation & preflight

Service-boundary: UUID shapes, `limit ≥ 1`, declared-key/type checks, ref length ≤ 512,
text sizes bounded (contentText ≤ 64KB; memory value ≤ 4KB; **contentJson ≤ 64KB and
aiParams ≤ 16KB** — JSONB cannot smuggle blobs past refs-never-bytes), importance ∈ [0,1],
identifier-ish columns capped (≤200; kinds ≤100; sessionId ≤128, never `""`),
`occurredAt` sanity-bounded. All mirrored as DB CHECKs.

```sql
-- Tenant integrity (expect 0): a workspace row's tenant must match its student's
SELECT COUNT(*) FROM works w JOIN students s ON w.student_id = s.id WHERE w.tenant_id != s.tenant_id;
SELECT COUNT(*) FROM interactions i JOIN students s ON i.student_id = s.id WHERE i.tenant_id != s.tenant_id;
SELECT COUNT(*) FROM memories m JOIN students s ON m.student_id = s.id WHERE m.tenant_id != s.tenant_id;
-- No orphan workspace rows (FKs enforce; drift check)
SELECT COUNT(*) FROM works WHERE student_id NOT IN (SELECT id FROM students);
-- No empty works
SELECT COUNT(*) FROM works WHERE content_url IS NULL AND content_text IS NULL AND content_json IS NULL;
-- CROSS-STUDENT POINTERS impossible (composite FKs enforce; drift check — expect 0)
SELECT COUNT(*) FROM interactions i JOIN works w ON i.output_work_id = w.id WHERE i.student_id != w.student_id;
SELECT COUNT(*) FROM memories m JOIN interactions i ON m.source_interaction_id = i.id WHERE m.student_id != i.student_id;
-- memoriesExtracted integrity: every linked id exists AND belongs to the same student
SELECT COUNT(*) FROM interactions i CROSS JOIN LATERAL unnest(i.memories_extracted) mid
WHERE NOT EXISTS (SELECT 1 FROM memories m WHERE m.id = mid AND m.student_id = i.student_id);
```

The PGlite migration suite realizes these as permanent CI preflights (Phase-1 pattern), and
the `verify-postgres16` CI job runs them against real PG16.

---

## Retention & privacy (binding, from data-and-privacy.md + architecture §12)

- Workspaces live for the account lifetime + 1 year after deletion; interactions/memories
  follow the workspace.
- **No raw audio ever**; doodles/voice as refs only; ASR transcript is the only textual form.
- Parent-facing reads (Phase 3): works + summaries; raw transcripts and `aiParams` are
  operator-only. Children never see `degraded`/`aiParams`/error states.
- **Divergence from §12.1 (lead-serialized)**: on-row provenance (`metadata.aiParams`/
  `degraded`) follows the WORK's retention (model-output-is-a-contract rollback records) —
  §12.1's 90-day class applies to traces/logs only.

---

## Divergence from architecture v2 §2.2/§3.2 (lead-serialized)

Intentional drops/changes vs the design sketch — deferrals, not oversights:

- **Closed content-type enum → opaque `ArtifactType`** (lesson-extensible, enums.ts rule)
- **`contentJson` ADDED** (structured works, e.g. the birth certificate)
- **`Work.updatedAt`/`StudentWorkspace.updatedAt` dropped** — works are immutable in
  Phase 2 (no update path exists); the summary's `lastActivityAt` covers freshness
- **`input.metadata` escape hatch dropped** — structured inputs persist as canonical JSON
  in `text`; an open `Record` invites unbounded/unauditable payloads
- **`Memory.embedding` dropped** (pgvector arrives WITH Phase 4 — its migration)
- **`Memory.context.collectedAt` dropped** — `createdAt` covers it (one clock, no drift)
- **`Work.metadata.toolUsed` dropped** (no tool registry until Phase 5)
- **`input/output.type` → `kind`** (matches the wire `InteractionInput.kind`)
- **`tools` endpoint + POST write endpoints dropped** (Phase 5 / Phase 6 + auth)
- **Index note**: no classroom-order (`occurred_at`) or per-session index yet — acceptable
  at Phase-2 volumes; add with the Phase-4 agent's query patterns if needed.

---

## Pending amendments (frozen v1.1 — implementation lands with Phase 4 / 4.5)

Declared HERE so this contract never contradicts its Phase-4 readers ([`agent-context.md`](agent-context.md),
[`ip-character.md`](ip-character.md)); each is an ADDITIVE migration owned by H:

| Field | Owner | Allowed values | Notes / preflight | Lands |
| --- | --- | --- | --- | --- |
| `StudentMemory.key = "episode"` carve-out | H (write path), I (producer) | schema-valid `EpisodeValue` JSON only (`parseEpisodeValue` — the SAME validator the gateway uses) | see the amended `StudentMemory.key` row above; undeclared-key preflight excludes `episode` | **IMPLEMENTED (P4 Step 3)** |
| `StudentMemory.key = "self_narrative"` carve-out (v1.3, hardened v1.4) | H (write path), I (sole producer = lesson-end ReflectionService — by CONVENTION: enforced by the writes-are-server-internal boundary + the validator preflight, not caller identity) | schema-valid `DiaryEntryValue` JSON only (`parseDiaryValue`); DETERMINISTIC v1 composed from the session's reviewed episode summaries (trailing punctuation stripped) + the CURATED works count (DISTINCT types — matches the wall, refines never inflate it); defensive safety review before storage; **idempotent per (student, lesson), DB-ENFORCED** (migration 009 partial unique index — re-takes never duplicate, concurrent writers lose to `already_written`); truncation cuts at a sentence boundary, code-point-safe, COUNTED; EXCLUDED from semantic context retrieval; ordering by `memories.seq` (migration 009 — the works.seq tie fix extended); traces (CLOSED): `reflection_written` / `reflection_skipped` (cause ∈ already_written \| no_episodes) / `reflection_failed` (cause ∈ safety_rejected \| schema_invalid) / `reflection_crashed` / `reflection_truncated` / `reflection_episode_malformed`; reader = playground worldView (摊开的日记, top 5, key-set exactly {summary, createdAt} on the wire) | undeclared-key preflight excludes `self_narrative` too; the LESSON VALIDATOR rejects a lesson declaring it (v1.4 — closing the extraction-path producer hole) | **IMPLEMENTED (P6.5 Step 4 + review hardening)** |
| `InteractionRecord.safety` | H | `ok \| input_filtered \| output_filtered` | additive column (migration 004); recorder sets it from `AiMeta.filtered`; **Phase-4 scope: CONVERSATIONAL exchanges only** — image exchanges (doodle/answers) always record `ok` (their degradation is visible via `output.degraded`; image-path filtered-marking folds in with real moderation, M6); **backfill `"ok"` is a labeling DEFAULT, not evidence of review** — readers injecting pre-migration transcripts into model context must exclude/re-review rows with `output.degraded = true` | **IMPLEMENTED (P4 Step 3)** |
| `WorkMetadata.ipCharacterVersion?` | H (column), 4.5 writers | positive int (version pointer) | links artifacts to the character version they DERIVE FROM (current at record time); a FAILED character lookup is traced `work_lineage_missing` (accept-with-trace); pre-character lesson-1 rows are intentionally unstamped — NOT drift, untraced (P4.5-B scoping amendment) | **IMPLEMENTED (P4.5, migration 005)** |
| Works lifecycle rev: one Work per completion **EVENT** | H + C | — | replaces lifecycle rule 3; shipped WITH parent-share v1.3 curation (decision ②) | **IMPLEMENTED (P4.5)** |

## Changelog

- **v1.2** (2026-06-10, lead-serialized with Phase 4.5 — coupled to parent-share.md
  v1.3): works lifecycle rule 3 revised to one Work per completion EVENT (iteration =
  first-class history; `workspace_work_iteration` replaces the stale_recomplete
  divergence trace); `WorkMetadata.ipCharacterVersion` lands (migration 005) —
  pending-amendments table entries marked implemented.
- **v1.4** (2026-06-11, lead-serialized after the deferred Step-4 adversarial review —
  4 confirmed majors fixed): lesson validator now rejects `self_narrative` declarations
  (the extraction path could otherwise mint MODEL-AUTHORED diary entries served to the
  child — the sole-producer chain's one hole); idempotency DB-enforced (migration 009
  partial unique index; probe-proven check-then-write race closed); `memories.seq` added
  (the works.seq created_at-tie fix extended to greeting/diary/episode-order reads);
  madeCount = curated DISTINCT-type count; truncation sentence-bounded + counted;
  malformed episode rows counted at every read.
- **v1.3** (2026-06-11, lead-serialized with P6.5 Step 4): `self_narrative` reserved-kind
  carve-out — the companion diary (L1 reflection, deterministic tier). Same discipline as
  `episode`: schema-valid only, never lesson-declarable, preflight-excluded; ADDITIONALLY
  excluded from semantic context retrieval (the cold block's content is a versioned
  contract — a new kind leaking in would be a silent context change).
- **v1.1** (2026-06-09, lead-serialized with the Phase-4 contract freeze): `episode`
  reserved-kind carve-out on `StudentMemory.key` (+ preflight exclusion); pending-amendments
  table (`safety` column, `ipCharacterVersion` lineage, works-lifecycle rev pointer);
  companion links to agent-context.md / ip-character.md.
- **v1** (2026-06-09): initial freeze.

_Workspace Contract · Phase 2 · Frozen v1.4 · 2026-06-11_
