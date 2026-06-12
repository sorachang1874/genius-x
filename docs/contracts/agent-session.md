# Agent Session Contract (playground — the friend at home)

**Status**: Frozen v1.2 (v1.1 + the greeting cold-miss semantics — see Changelog)
**Owner**: Course runtime (Agent C) — session lifecycle; Agent service (Agent I) — context;
parent surfaces (Agent K) — the unlock door
**Typed realization**: `packages/contracts/src/agent-session.ts` (to be added)
**Companion contracts**: [`world.md`](world.md)、[`theme.md`](theme.md)、
[`parent-surface.md`](parent-surface.md)(解锁门)、[`scene.md`](scene.md)(AI 档复用)、
[`tool.md`](tool.md)(封闭机制枚举;grant 模型的家 = 本契约规则 6)、[`data-and-privacy.md`](data-and-privacy.md)、APP PRD §5/§6
**Last updated**: 2026-06-10

---

## Purpose

The after-class playground session: parent-opened, child-driven, friend-hosted,
narratively time-bounded. **It is NOT the classroom state machine** (no reducer sharing —
teacher-driven configured stages vs child-driven open visits); it **IS the same
capability sandbox** (TurnBuffer, ContextBuilder, safety gates, concurrency gate, round
caps — one security surface, two doors).

## Session lifecycle

```
parent taps 「把屏幕交给孩子」 (parent H5/小程序)
  → mint PLAYGROUND TOKEN — NEW table `playground_session_tokens` (token_hash PK
    sha256-hex, student_id + tenant_id composite FK to students(id, tenant_id),
    expires_at; TTL CHECK ≤ 35 min (= ceiling 30 + grace 5); uniform 404;
    scope = ONE student, playground ONLY;
    TTL = session quota + GRACE WINDOW (5 min: server enforces read-only/no-AI
    during grace — the wind-down and close ritual complete inside it; session-close
    writes, incl. episodic consolidation, land inside grace).
    Minting REVOKES any prior unexpired playground token for that student (a NAMED
    divergence from share-token re-mint semantics — the token IS the session lock);
    a second device opening mid-session gets the warm "朋友已经在那边和你玩啦" state)
  → child's world opens (visit ritual: the friend notices, greets from episodic
    memory. v1.2 semantics: ZERO episodes = a legitimate first visit — generic warm
    greeting, UNTRACED (the agent-context empty-profile precedent); a MALFORMED newest
    episode = a corruption signal — generic warm greeting + `context_cold_miss`
    (cause=episode_malformed), counted never swallowed)
  → free visit (zero-AI floor always; AI-tier objects only behind gates ①-④, rule 3)
  → wind-down (quota approaching: the friend gets sleepy — gradual, never a popup)
  → close ritual (the child tucks the friend in; world goes to night; "明天见")
  → token expires; reopen attempt ⇒ the friend is asleep (no failure state,
    no content supply); next day the friend wakes refreshed
```

**Transport ruling (this token class — the v1.1 rule: no inheritance)**: enters the
child device via URL hand-off, value scrubbed on mount (the parent-token mechanism
reused); sub-requests ride the Authorization header; history persistence not accepted
(session-TTL minutes + one-student playground scope keep the blast radius small, but
scrub is cheap and uniform). **Exposure**: ALL child-at-home traffic rides token-gated
`GET/POST /playground/*` — the THIRD internet-facing route family, serialized into
parent-share.md v1.5 (never the operator-posture endpoints). **A mid-visit 404 on the
child surface renders the asleep-world scene from client-cached assets — never error/
retry copy** (preflight below); the close ritual is bundled with the zero-AI floor
assets so it plays without any server call.

## Hard rules

1. **Quota & curfew are CONFIG, not code** (Q1 posture, founder-accepted 2026-06-10):
   defaults — daily 15 min (ages 4-6) / 20 min (7-10), hard ceiling 30 (mirrors the
   in-class line), curfew 21:00 ("the friend sleeps"). **Parents can lower, never raise
   past the ceiling.** Story-time audio holds a SEPARATE parent-visible audio allowance
   (default 15 min; window 20:30–21:00 = the wind-down that ENDS in 盖被子; final
   external wording rides Q5's legal track). Storage: tenant defaults = `tenants.config`
   JSONB key `playground` (existing column); per-child parent override = 🆕 column on
   `playground_session_tokens`' companion settings table `playground_settings(student_id,
   tenant_id composite FK, daily_minutes CHECK ≤ 30, audio_minutes, updated_at)` —
   bounds DB-CHECKed (a parent write above the ceiling rejects). Changing numbers is an
   ops act, not a release. **v1.1 interim (until the config read + settings table land,
   DF-v2-28)**: the DAILY bound is enforced AT THE MINT, gate-⑤-compatibly — the mint
   sums today's (Asia/Shanghai day) consumed minutes from `playground_session_tokens`
   (revoked tokens count elapsed time only) and grants the REMAINING quota (+grace),
   rejecting when < 3 min remain (`playground_mint_quota_exhausted`, parent-gentle copy);
   defaults are constants in code for v0, named as the deferral they are.
2. **Zero-AI floor is the availability class**: theme dressing room, gallery replay,
   sticker collage (= the v0 playground). Gateway unavailable ⇒ the WHOLE session
   degrades to the floor ("朋友在专心画画,你先布置房间") with the dedicated
   `playground_floor_entered` trace — the floor must never become an invisible normal
   path (AGENTS.md degradation principle, named trace REQUIRED).
3. **The FIVE gates** (playground AND co-create — parent presence mitigates, never
   exempts): for ANY after-class AI conversation — ① real providers (DF-1/DF-v2-22);
   ② real content moderation (DF-2 — the 6-keyword placeholder is an ABSOLUTE blocker
   after class); ③ companion-conduct.md frozen + CI-enforced; ④ load validation
   (DF-v2-21). And for ANY playground DB write at all (incl. zero-AI-floor session
   records): ⑤ **data-and-privacy.md upgraded** to cover after-class collection (the
   PRD §8.6 binding gate, serialized here) **together with the workspace.md amendment**
   adding the source/mode discriminator (classroom | playground | cocreate) on
   interactions — home-Sunday rows must be distinguishable from class rows for parent
   DENY surfaces and analytics. Until ⑤: the playground reads, never writes.
4. **No recall mechanics, ever**: zero push/red dots/streaks to the child. The friend's
   missing-you flows ONLY through parent channels and physical objects.
5. **Input grammar (v1)**: touch + icon/image options, friend reads options aloud (TTS
   out is fine); **no microphone after class** (data-and-privacy: family-room ambient
   audio is never captured; voice stays in the classroom). Free text never enters
   prompts (tool.md rule extends).
6. **Grant model (earned is forever — Q8 recommended posture, table designed
   append-only)**: 🆕 `tool_grants(student_id, tenant_id composite FK to
   students(id, tenant_id), tool_id, source_lesson_id, granted_at;
   UNIQUE(student_id, tool_id, source_lesson_id) ON CONFLICT DO NOTHING — the
   lesson-end writer retries idempotently, the P4.5 pattern)` — no revocation column
   BY DESIGN. **Append-only excludes exactly one path: the DF-v2-17 erasure cascade**
   (legally required per-student deletes; the append-only assertion test allows it).
   Membership lapse gates breadth of NEW supply (letters, new skins), never revokes
   earned abilities — a friend that "forgets skills" is a child-visible failure state
   (banned). Reversing this is a formal contract revision with named cost.
7. **Memory continuity**: playground interactions write to the SAME
   works/interactions/memories tables (one memory substrate, two doors) — what
   happened at home on Sunday, the friend remembers in class on Monday. Episodic
   consolidation reuses the scene-exit pipeline at session close.
8. **Session concurrency**: one active playground session per student — enforced by
   the mint (rule: minting revokes the prior unexpired playground token, lifecycle
   above) plus a uniqueness check on active `agent_sessions`. Playground traffic
   shares the gateway FIFO semaphore with classrooms — **honest note: a shared FIFO
   means classroom starvation IS possible under playground load**; it is operator-
   visible via `gateway_queue_wait`, and classroom-priority ordering (two-tier queue)
   is the NAMED follow-up, triggered when classroom p95 queue-wait exceeds 1s during
   any observed peak.

## Failure modes

| Scenario | Behavior |
| --- | --- |
| Gateway down/degraded | Floor mode (rule 2), `playground_floor_entered` trace |
| Token expired mid-visit | Grace window covers the wind-down + close writes (lifecycle); past grace, any 404 renders the client-cached asleep-world scene — never error/retry copy; re-entry = friend asleep |
| Quota service miss | Fail-closed to the MOST RESTRICTIVE of (system default, last-cached parent setting) — an outage never grants MORE time than a parent allowed; `playground_quota_config_miss` trace |
| Distress disclosure | Warm containment (no visible failure) + parent alert (immediate, automated) + operator review queue (next-morning SLA); content NEVER enters long-term memory (companion-conduct.md) |
| Curfew reached | The friend is already asleep at entry; whispers in dreams; no interaction, no failure state |

## Owner matrix

| Field | Owner | Source of truth | Allowed values | Consumers | Fallback | Deletion | Preflight |
| --- | --- | --- | --- | --- | --- | --- | --- |
| playground token | K (mint via parent door, parent-surface.md v1.2) | 🆕 `playground_session_tokens` (hash-only PK, student_id + tenant_id composite FK to students, expiry CHECK ≤ quota+grace) | one student, playground scope, session TTL | session runtime | uniform 404; mid-visit ⇒ client-cached asleep scene | expiry+24h purge (boot sweep pattern) | hash-only + scope + composite-FK drift (expect-0) + 404→asleep-scene test |
| quota/curfew config | C | tenant defaults = `tenants.config` JSONB key `playground` (existing); per-child override = 🆕 `playground_settings` (composite FK, CHECK ≤ ceiling) | rule-1 bounds | session runtime, parent panel | most-restrictive fail-closed (failure row) | settings row follows DF-v2-17 erasure cascade | bounds test (parent write above ceiling rejects); composite-FK drift |
| `tool_grants` | C (write at lesson end) / I (read) | 🆕 append-only table (rule 6: composite FK, UNIQUE + ON CONFLICT DO NOTHING) | granted rows only — no revocation (sole exception: DF-v2-17 erasure cascade) | playground tools, parent capability list | absent = not granted (object simply not rendered) | DF-v2-17 erasure cascade ONLY | append-only assertion (erasure-aware); idempotent-retry test; composite-FK drift |
| session record | C | 🆕 `agent_sessions` (composite FK; lifecycle states above) | lifecycle states | metrics, quota accounting | n/a | retention 1y then aggregate-and-delete; DF-v2-17 cascade | one-active-per-student test; composite-FK drift |
| trace taxonomy (CLOSED) | C | this row | exactly: `playground_floor_entered`, `playground_quota_config_miss`, `playground_session_opened/_closed`, `playground_token_revoked_by_remint`, `playground_mint_curfew_rejected`, `playground_mint_quota_exhausted` (v1.1 — parent-affecting rejections must be countable); greeting cold-miss REUSES `context_cold_miss` (agent-context.md). **v0 semantics**: opened==minted; `_closed/_floor_entered/_quota_config_miss` are allowed-but-not-yet-emitted (no session record pre-gate-⑤) — dashboards must not expect closes | operator metrics | n/a | exact-match trace tests: the emitted-reason set is a SUBSET of this list (CI) |

## Changelog

- **v1.2** (2026-06-11, lead-serialized after the deferred Step-4 review): greeting
  cold-miss semantics pinned — zero episodes is a legitimate untraced first visit;
  a malformed newest episode traces `context_cold_miss` (cause=episode_malformed).
  The v1 wording ("miss ⇒ traced") conflated the two; code and contract now agree.

- **v1.1** (2026-06-10, lead-serialized after the Step-3 adversarial review): closed
  trace taxonomy gains `playground_mint_curfew_rejected` + `playground_mint_quota_
  exhausted` (parent-affecting rejections are countable) with v0 emission semantics
  pinned (opened==minted, no closes yet); the daily quota is mint-enforced from token
  history (gate-⑤-compatible interim — config read & settings table = DF-v2-28); TTL
  CHECK tightened to 35 min; the exact-match preflight is subset-style and CI-enforced.

- **v1** (2026-06-10): initial freeze, converged pre-merge with the adversarial contract
  review (1 blocker + 6 majors fixed): `/playground/*` exposure serialized into
  parent-share.md v1.5 (the third route family — never asserted unilaterally);
  `playground_session_tokens` pinned as a SEPARATE token class (parent-surface.md v1.2
  names the unlock mint as the second parent write); TTL = quota + 5-min grace (close
  writes land inside grace; mid-visit 404 ⇒ client-cached asleep scene); quota storage
  pinned (tenants.config + 🆕 playground_settings, most-restrictive fail-closed);
  gate ⑤ added (data-and-privacy upgrade + workspace.md mode discriminator before ANY
  playground write); tenant composite FKs + idempotent grant writes + Deletion columns
  + closed trace taxonomy; honest shared-semaphore note (classroom-priority = named
  follow-up at p95 queue-wait > 1s). Core: lifecycle + sleepy wind-down, zero-AI floor,
  five gates, no-mic input grammar, earned-is-forever grants, single memory substrate.

_Agent Session Contract · APP integration · Frozen v1.2 · 2026-06-11_
