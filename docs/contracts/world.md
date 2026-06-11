# World Contract (APP integration — the friend's home)

**Status**: Frozen v1 (scope = APP PRD §0/§2/§6 的世界呈现层;乐园 v0 与 Shell 重构的依据)
**Owner**: Student classroom flow / child surfaces (Agent B) — rendering; Lead — the mapping table
**Typed realization**: `packages/contracts/src/world.ts` (to be added with the Shell work)
**Companion contracts**: [`theme.md`](theme.md)(世界长什么样)、[`agent-session.md`](agent-session.md)
(孩子何时在世界里)、[`workspace.md`](workspace.md)、[`ip-character.md`](ip-character.md)、
APP PRD §0.5(形态无关约束,创始人 2026-06-10)
**Last updated**: 2026-06-10

---

## Purpose

The child never sees "an app" — they visit **the friend's home**. This contract pins the
ONE rule that keeps the app from decaying into a feature grid: **every engineering asset
type maps to exactly one in-world object, through a CLOSED table, frozen here.** A new
asset type may not ship until its world-object row exists.

## Hard rules

1. **Form-agnostic (BINDING, founder 2026-06-10)**: the companion is NOT necessarily
   humanoid (animal/other forms — decision ④ addendum). No world object, copy line, or
   layout may assume a human form. Object names below are NEUTRAL placeholders; their
   final visual/verbal dress arrives with the brand doc (DF-v2-18) without changing
   this mapping.
2. **The child-facing iron rules apply** (APP PRD §6.5): no menus/settings/feeds/badges/
   push/red dots; navigation = the friend's gaze and motion; empty = "the world is still
   small" (narrative), slow = "the friend is thinking", error = the friend rephrases
   (degradation, operator-counted). Banned-wording scan covers all world copy.
3. **Earned, not pre-stocked**: the world starts SMALL (one room, one light, the v1.0
   birth snapshot on the wall). Richness only ever comes from the child's own assets
   appearing. A pre-decorated world is a contract violation (it destroys the 赋灵 arc).

## The mapping table (CLOSED — additions are lead-serialized contract revisions)

| Asset (source of truth) | World object (neutral placeholder) | Render rule | Phase |
| --- | --- | --- | --- |
| Work + lineage (`works`, P2/P4.5) | 作品上墙/上架 | latest-per-type curated; tap = replay (打磨轨迹 animation) | 乐园 v0 |
| IP character version (`ip_character_versions`) | 相册(成长快照) | version ASC; v1 = 诞生 | 乐园 v0 |
| Temporary skin (decision ④) | 衣柜/换装角 | apply = temporary, auto-revert, snapshot-logged | 乐园 v0 |
| ThemePack ([`theme.md`](theme.md)) | 世界本身的样子 | never shown "as an asset"; applies ambiently | 乐园 v0 |
| Episodic memory (`memories`, key="episode" — agent-context.md) | 回忆罐 | the FRIEND retells (TTS), never raw transcripts | 乐园 AI 档(agent-session.md 五道闸后) |
| Companion diary (`self_narrative`, L1) | 摊开的日记 | curated entries only; deterministic v1 | L1 |
| Tool grant ([`agent-session.md`](agent-session.md) rule 6 — the grant model's home) | 工作台上的器械 | visible ONLY when granted ("学会了新本领") — an ungranted tool simply isn't there (never a locked/grey button) | 乐园 AI 档 |
| Letter/surprise (L3 outbox) | 惊喜信箱 | child discovers; NEVER announced by push | L3 |
| Parent note (P6 `parent_notes`) | (no object) | relayed through the friend's speech only — a raw "inbox" is banned (浸泡式); relay semantics stay parent-surface.md's | P6 (shipped — CLASSROOM relay); in-world speech relay = 乐园 AI 档(五道闸) |
| Co-created work (`co_created` mark) | 上墙,特殊光 | dual-signature framing | 共创 v1 |

**Closure rule**: anything not in this table does not render in the child's world.
**The enforcement mechanism (pinned — review fix; the tools.ts registry pattern)**:
a checked-in registry `apps/web/src/modes/playground/world/registry.ts` whose entries
mirror this table 1:1. ALL world-object components live under that directory and must be
registered. CI asserts: (a) registry keys == a checked-in copy of this table (diffed);
(b) no component under the world dir is unregistered (export scan); (c) imports of world
components from outside the registry are lint-banned; (d) the banned-wording regex runs
over the registry's component strings. "Child-rendered" is thereby a DIRECTORY property,
not an aspiration.

## Failure modes

| Scenario | Behavior |
| --- | --- |
| Asset fetch fails | The object simply isn't shown this visit (the world is never "broken"); `world_object_miss` trace with asset kind — countable, never silent |
| All fetches fail | The room renders from the cached shell + theme; friend idles; `world_render_floor` trace |
| New asset type without a row | Build-time failure (registry-mirror CI) — not a runtime fallback |

## Owner matrix

**Deletion/retention note**: this contract owns NO stored child data — every rendered
asset's retention/erasure follows its source-of-truth contract (workspace.md,
ip-character.md, theme.md, agent-session.md). The registry is code, versioned in git.

| Field | Owner | Source of truth | Allowed values | Consumers | Fallback | Preflight |
| --- | --- | --- | --- | --- | --- | --- |
| mapping table | Lead (serialized) | this doc | closed rows above | Shell renderer, world components | n/a | registry-mirror CI (mechanism above) |
| object copy | B | component strings | banned-wording-clean, form-agnostic | child UI | n/a | banned-wording scan (extended to world components) |
| trace taxonomy (CLOSED) | B | this row | exactly: `world_object_miss`, `world_render_floor` | operator metrics | n/a | trace-reason exact-match tests |

## Changelog

- **v1** (2026-06-10): initial freeze, converged pre-merge with the adversarial contract
  review — enforcement mechanism pinned (registry mirroring, the tools.ts pattern),
  episodic source corrected to `memories` key="episode", grant-model home = agent-
  session.md rule 6, parent-note phase qualified (classroom relay shipped; in-world
  speech = AI 档), deletion note (no stored data here), closed trace taxonomy.
  Core: closed asset→object mapping, form-agnostic, earned-not-prestocked.

_World Contract · APP integration · Frozen v1 · 2026-06-10_
