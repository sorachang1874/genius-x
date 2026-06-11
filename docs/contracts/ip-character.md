# IP Character Contract (Phase 4.5)

**Status**: Frozen v1 (implementation: Phase 4.5; the layered model binds all Phase 4+
design immediately)
**Owner**: Student workspace (Agent H) — storage; Agent service (I) — canon injection;
brand DNA versioning — [`brand-style.md`](brand-style.md) (D)
**Phase**: Phase 4.5 — IP character entity & versioning (per
[`../product/ip-character-concept-decisions.md`](../product/ip-character-concept-decisions.md))
**Typed realization**: `packages/contracts/src/ip-character.ts`
**Companion contracts**: [`identity.md`](identity.md) (GeniusXProfile transition),
[`workspace.md`](workspace.md) (works lineage), [`agent-context.md`](agent-context.md)
**Last updated**: 2026-06-09

---

## Purpose

The product anchor: each child's **personal IP character** (the AI friend) — created in
lesson-001 (the 出生证 ritual = **version 1.0 snapshot**), then continuously refined across
lessons. This contract defines the layered data model, version semantics, and the migration
away from the lesson-001-shaped `GeniusXProfile`.

---

## The layered model (founder decisions ③/④, P2)

> Layer split grounded in decision ③, which is **暂定执行 (provisional, pending team
> discussion)** — a reversal is a lead-serialized v2 of this contract, not a worker edit.

| Layer | Contents | Who changes it | When |
| --- | --- | --- | --- |
| **Base canon** (locked) | The essential 「伙伴」 base form + brand DNA (`brandStyleVersion` ref). | NEVER the runtime/child. Only a lead-serialized brand-version migration (when [`brand-style.md`](brand-style.md) revs). | Brand rev only |
| **Refinable surface** | `name`, `appearanceRef` (current avatar work pointer) + `appearanceTraits` (descriptors for regeneration consistency), `personality`, `backstory`; future additive: `vocalRef`, `videoRef`, … | The child, through scene outcomes (each accepted refinement = a new **version**). "可在一定程度上改写" — the degree is scene-designed, not engine-limited. | Any lesson |
| **Temporary skins** | Crossover/costume displays (e.g. third-party-style variations). | Recorded as **works only** (e.g. type `skin_display`), referencing the character version they derive from. **NEVER mutate canon or surface.** | Any scene; display-scoped |

Every change is **snapshot-recorded** (founder: "一切变化保留快照"); the base 伙伴 form is
**永远保留** under any surface rewrite or skin.

## Entity & versions

```
ip_characters            (one row per student — the CURRENT state)
  student_id (PK, composite FK → students(id, tenant_id)), tenant_id,
  base_canon JSONB        -- { brandStyleVersion, baseForm }
  surface    JSONB        -- { name?, appearanceRef?, appearanceTraits?, personality?, backstory?, ... }
  version    INT          -- current version number (≥ 1)
  updated_by JSONB        -- { lessonId, sessionId?, stageId? } provenance of the last refinement
  created_at, updated_at

ip_character_versions    (append-only, immutable — the growth timeline)
  id, student_id, tenant_id, version INT,
  base_canon JSONB, surface JSONB,   -- full snapshot at that version
  updated_by JSONB, created_at
  UNIQUE (student_id, version)
```

- Version 1 = the lesson-001 birth snapshot. **Backfill rule** (Phase 4.5): from the newest
  `birth_certificate` work + `GeniusXProfile`; a student with NO `birth_certificate` work
  backfills from `GeniusXProfile` alone, flagged degraded + traced (`ip_backfill_partial`)
  — countable, never silent.
- A refinement = atomically: bump `ip_characters` + insert the version row. Versions are
  never edited or deleted (retention follows workspace policy; right-to-erasure path
  DF-v2-17 includes both tables).
- **Refinement idempotency** (the existing system deliberately RE-RUNS write-backs:
  `late_prepare` mode, operator re-record, the admin re-apply tool): a write whose
  `base_canon` + `surface` equal the current row is a **NO-OP** — no version bump, traced
  `ip_refine_noop`. The parent-facing growth timeline never grows from a retry. Preflight:
  no two adjacent versions with identical snapshots (expect 0).
- **Works lineage** (additive `WorkMetadata` field, Phase 4.5 migration — declared in
  [`workspace.md`](workspace.md) v1.1 Pending amendments): `ipCharacterVersion?: number` —
  artifacts depicting the character link to the version they depict. The parent "growth
  story" and brand-conformance audits both read this.

## Phase 4.5 companion revs (frozen COUPLING — decision ②)

This contract does NOT ship alone. The same Phase 4.5 lead serialization MUST also freeze:

1. **Works lifecycle rev** (workspace.md vNext): one Work per completion **EVENT** —
   in-scene refinement becomes first-class history instead of "the kept artifact is the
   first draft" (today's `workspace_work_stale_recomplete` divergence rule).
2. **Parent curation rev** (parent-share.md vNext): decision ②'s three-layer browse model
   (per-lesson curated hero → stage slices e.g. 1/15→6/15→11/15→15/15 → full history in
   the Phase-6 workspace). The two MUST land together: recording every iteration without
   the curation rules floods the parent gallery with near-duplicate drafts.

An implementer fanning out on this contract without those two revs frozen is out of
process — stop and re-serialize through the lead.

## Source-of-truth transition (explicit migration — no dual ownership)

| Stage | Source of truth for companion state |
| --- | --- |
| Today (pre-4.5) | `students.genius_x` (`GeniusXProfile`, latest-wins COALESCE write-back) |
| Phase 4.5 ships | `ip_characters` is canonical. The lesson-end write-back writes the IP character (creating a version); `GeniusXProfile` becomes a **derived mirror** (written by the same service call, read-compatible for existing consumers) |
| Later (post-consumers-migrated) | `GeniusXProfile` fields deprecated; deletion condition: no readers (recorded in a future identity.md rev — identity.md gains a Changelog section at that rev) |

A field must never have two writers: from 4.5 on, NOTHING writes `genius_x` except the IP
character service's mirror step.

### Surface → `genius_x` projection map (the mirror step, pinned)

| Surface field | `genius_x` column | Resolution |
| --- | --- | --- |
| `name` | `genius_x_name` | verbatim |
| `appearanceRef` | `genius_x_avatar_url` | resolve the referenced work's `contentUrl` (same-student scoped; NOT the ref itself — the column is a URL; thumbnail never). **Surface carries NO appearanceRef ⇒ the column is left UNTOUCHED** (a pre-4.5 legacy URL may be unrecoverable as a work ref and must not be erased — P4.5-A review amendment); a later refinement WITH a ref re-takes ownership |
| `personality` | `genius_x_personality_tag` | verbatim |
| `backstory` | `genius_x_background_setting` | verbatim |
| — (no surface counterpart) | `genius_x_birthday_speech` | **NOT character state** — a lesson-001 ritual field. It stays writable by the SAME mirror service call with today's COALESCE latest-wins semantics, sourced from the lesson write-back input as now |

**Mirror write semantics, pinned**: projected fields are **replace-from-canonical** (the
mirror always equals the projection — including writing NULL when a surface field is
absent — EXCEPT the avatar column under the legacy-preservation rule above); the mirror
runs on the NO-OP path too (idempotent — a re-run heals a mirror an earlier crash left
stale); `appearanceRef` must be UUID-shaped and resolve to THIS student's work (the
same-student pointer discipline; checked before any write); ritual fields (`birthdaySpeech`) keep identity.md's COALESCE never-erase rule.
identity.md's COALESCE idempotency rule is superseded for the projected columns at the
4.5 rev (one writer, deterministic mirror). The mirror test asserts equality over
**projected fields only**.

## Consumption

- **Agent context** ([`agent-context.md`](agent-context.md)): current canon + surface are
  injected into every contextual LLM call; exempt from decay.
- **Generation consistency**: `appearanceRef`/`appearanceTraits` are the per-child
  conditioning inputs for image generation ([`brand-style.md`](brand-style.md) carries the
  brand side; this carries the per-child side).
- **Parent surfaces**: per-lesson share view MAY additively include the current character
  snapshot (lead-serialized parent-share rev when Phase 4.5 lands); the growth timeline
  (versions) is a Phase 6 authenticated surface.

## Owner matrix

| Field | Owner | Source of truth | Allowed values | Derivation | Consumers | Fallback | Deletion | Preflight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `(student_id, tenant_id)` | H | composite FK → `students(id, tenant_id)` | valid student | at create | isolation | none — write rejected | erasure path (DF-v2-17) | FK enforced |
| `base_canon.brandStyleVersion` | D (value), H (storage) | brand-style.md | versioned ids | current brand contract at create/brand-migration | context build, conformance audits | none | with row | matches a known styleVersion |
| `base_canon.baseForm` | lead (value), H (storage) | this contract | non-empty string | **4.5 backfill: a fixed constant ("魔法泥人基础形象 v0") pending the brand doc — traced as placeholder**; brand doc replaces it via lead-serialized brand migration | context build | none | with row | no empty/missing baseForm |
| `surface.*` | child via scene outcomes (writes through I→H) | `ip_characters.surface` | per-field size caps (name ≤ 50, traits ≤ 10×50, personality/backstory ≤ 500 chars — mirrored as DB CHECKs) | scene refinement | context build, mirror, parent (4.5 rev) | absent fields allowed | with row | CHECK bounds |
| `version` | H | `ip_characters.version` | int ≥ 1 | bump per accepted refinement (idempotency rule above) | timeline reads | none | with row | contiguity + no-adjacent-identical (SQL below) |
| `updated_by` | writer | `ip_characters.updated_by` | `{lessonId, sessionId?, stageId?}` | from the refining call | operator audit | none | with row | lessonId non-empty |
| version rows | H | `ip_character_versions` | immutable snapshots | insert-only | growth timeline (P6), audits | none | erasure path | UNIQUE(student, version) |

## Failure modes

| Scenario | Behavior |
| --- | --- |
| IP service/table unavailable | Context builds without canon (`context_canon_miss` traced); lesson runs; write-backs queue as today's profile write-back does (fire-and-forget, traced) |
| Refinement write fails | Traced (`ip_refine_failed`); the classroom output (work) still recorded; operator re-applies via admin tool (Phase 4.5 deliverable) |
| Skin recorded without version ref | Workspace accepts (back-compat) but traces `work_lineage_missing` — countable drift |

## Validation & preflight

```sql
-- the CURRENT version has a snapshot row (expect 0)
SELECT COUNT(*) FROM ip_characters c WHERE NOT EXISTS
  (SELECT 1 FROM ip_character_versions v WHERE v.student_id = c.student_id AND v.version = c.version);
-- contiguity from 1: snapshot count per student equals the current version (expect 0)
SELECT COUNT(*) FROM ip_characters c WHERE
  (SELECT COUNT(*) FROM ip_character_versions v WHERE v.student_id = c.student_id) != c.version;
-- no snapshot beyond the current version (expect 0)
SELECT COUNT(*) FROM ip_character_versions v JOIN ip_characters c USING (student_id)
  WHERE v.version > c.version;
-- idempotency: no two ADJACENT versions with identical snapshots (expect 0)
SELECT COUNT(*) FROM ip_character_versions a JOIN ip_character_versions b
  ON a.student_id = b.student_id AND b.version = a.version + 1
  WHERE a.base_canon = b.base_canon AND a.surface = b.surface;
-- orphan check (composite FK enforces; drift check, expect 0)
SELECT COUNT(*) FROM ip_characters WHERE student_id NOT IN (SELECT id FROM students);
-- REAL tenant isolation (expect 0)
SELECT COUNT(*) FROM ip_character_versions v JOIN students s ON s.id = v.student_id
  WHERE v.tenant_id != s.tenant_id;
```
- Layer test: a surface refinement never changes `base_canon`; a skin work never touches
  either.
- Mirror test: after a refinement, `genius_x` mirror matches the surface projection.

## Changelog

- **v1** (2026-06-09): initial freeze — layered model, version semantics, GeniusXProfile
  transition plan, works lineage fields.

_IP Character Contract · Phase 4.5 · Frozen v1 · 2026-06-09_
