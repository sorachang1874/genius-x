# Parent Surface Contract (Phase 6)

**Status**: Frozen v1.2 (v1.1 + the playground unlock mint — see Changelog)
**Owner**: Parent surfaces (Agent K) — H5/routes; parent access tokens — share-service
patterns (Phase 3 machinery); note injection — Agent I (context builder)
**Typed realization**: `packages/contracts/src/parent-surface.ts`
**Companion contracts**: [`parent-share.md`](parent-share.md) (the unauthenticated
per-lesson capability link — its BINDING exposure rule is amended to v1.4 by this freeze,
adding token-gated `/parent/*`; everything else unchanged), [`identity.md`](identity.md),
[`ip-character.md`](ip-character.md) (the growth timeline's source),
[`agent-context.md`](agent-context.md) (note injection), [`data-and-privacy.md`](data-and-privacy.md)
**Last updated**: 2026-06-10

---

## Purpose

The parent's AUTHENTICATED home surface (decision ②'s third layer + the co-working
vision): all of their children, each child's growth timeline (the IP character's版本史)
and full works history — plus co-working v1: **a parent note the companion relays to the
child next lesson** (「爸爸妈妈想对你说」).

## Auth (lead decision 2026-06-10 — the seam, not the final provider)

| Property | Rule |
| --- | --- |
| v1 credential | **Parent access token** — the PROVEN Phase-3 capability machinery (256-bit, sha256-hash-only storage, uniform 404), but PARENT-scoped: bound to `parentId`, covering ALL that parent's children; expiry 180 days; re-mint on demand |
| Mint | Operator posture (`POST /parents/:id/access` — the identity-admin trust level, never internet-exposed). SMS-OTP / WeChat login (Better Auth) replaces the MINT path later behind the same verifier seam — the routes/reads never change (shadow rule: pluggable, not required) |
| Transport | parent-share.md's BINDING exposure rule (amended to v1.4 with this freeze) names token-gated `GET/POST /parent/*` as the second internet-facing route family — everything else (including the `/parents/:id/access` mint) stays operator-network only |
| H5 entry (v1.1) | The home opens via `?parent=<token>` (presence-routed like `?share=`). **History/screenshot persistence is NOT accepted for this token class** (unlike the scoped share token — this one is 180-day, ALL-children, write-capable): BINDING preconditions are (a) the global no-referrer meta (index.html) and (b) **scrub-on-mount** — the H5 captures the token into memory at first render and `history.replaceState`s the value out of the address bar (presence kept for routing). A reload after scrub lands on the warm re-request guidance; the original minted link still works. Sub-requests ride the `Authorization` header only |
| Mid-session death (v1.1) | The uniform 404 on ANY call (children/timeline/note) ⇒ the H5 shows the warm **re-request guidance** — never retry copy ("休息一下") or rewording copy ("换个说法") for a dead credential. 400 stays gentle-rewording; network/5xx stays gentle-retry. This distinction is server-given — no client oracle is invented |
| Scope | One parent's children ONLY (every read joins through `students.parent_id`); tenant isolation unchanged |

## Reads (privacy boundary — the DENY discipline extends)

| Endpoint | Serves | Never serves |
| --- | --- | --- |
| `GET /parent/children` | each child: displayName, age, companion surface (name/personality — the PARENT-visible canon), lesson progress | internal ids beyond the route's own child ids |
| `GET /parent/children/:id/timeline` | the GROWTH TIMELINE: `ip_character_versions` (version, surface, createdAt, lessonId provenance) joined with lineage works (the artifacts depicting each version) | `base_canon` internals beyond brandStyleVersion absence — serve the SURFACE only |
| `GET /parent/children/:id/works` | full works history (cursor-paginated, the Phase-2 read shapes, DENY-scrubbed contentJson) | transcripts, episodes (pending decision — same DENY as parent-share v1.2), aiParams/degraded/sessionId/stageId |
| All | — | raw interaction records of any kind |

## Co-working v1: the parent note

| Property | Rule |
| --- | --- |
| Write | `POST /parent/children/:id/note` `{text}` (co-working v1) and `POST /parent/children/:id/playground-session` (the playground UNLOCK MINT, v1.2 — mints a `playground_session_tokens` row, [`agent-session.md`](agent-session.md)) — the only two parent writes |
| Validation | text 1–200 chars; SAFETY-REVIEWED at the boundary (parent input is still input — filtered ⇒ 400 with a gentle message, never stored); rate: ≤ 3 pending notes per child (DB-checked) |
| Storage | `parent_notes` table (note, parent_id, student_id + tenant composite FK, created_at, relayed_at NULL until used) — NOT a memory row (it is parent content, not the child's memory) |
| Relay | The context builder injects UNRELAYED notes into the cold block (`【爸爸妈妈想对你说】`, ≤2 newest) and rides their ids on `ColdContext.noteIds`; the CONTROLLER marks `relayed_at` (fire-and-forget) only after a **NON-DEGRADED** LLM reply — a gateway fallback (filtered/error/timeout) never consumed them, so they stay unrelayed and retry next call. **Accepted residual**: the gateway's defensive context review dropping the cold block still counts as use (that drop is operator-visible via its own safety trace) |
| Visibility | Operator: countable traces, exact reasons `parent_note_stored` / `parent_note_rejected` (`cause` ∈ length \| safety_filtered \| pending_cap — NEVER note text) / `parent_note_relayed` (fires only when the mark LANDS) / `parent_note_relay_failed`. The CHILD hears it via the companion — never sees a raw "message inbox" (浸泡式, no app-like surfaces) |
| Failure | Notes service down ⇒ the lesson runs without them (shadow rule); relay failure ⇒ note stays unrelayed, retried next call |

## Owner matrix

| Field | Owner | Source of truth | Allowed values | Derivation | Consumers | Fallback | Deletion | Preflight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| parent access token | K (routes), share-machinery patterns | `parent_access_tokens` (hash-only) | 43-char base64url raw, once | mint | all /parent/* reads | uniform 404 | expiry+30d purge (the share sweep pattern) | hash-length preflight; expiry-sane CHECK |
| timeline view | K | `ip_character_versions` ⋈ works lineage | surface-only projection | per child | parent H5 | empty timeline = pre-first-lesson (legit) | follows erasure path (DF-v2-17) | DENY serialization test (no base_canon/internal ids) |
| `parent_notes` | K (write), I (relay) | new table (migration) | reviewed text ≤200 | parent input | context builder | none — write rejected on filter | erasure path + relayed retention (1y) | ≤3 pending per child; reviewed-before-stored test |
| note relay | I (inject) + C (mark) | `relayed_at` | NULL → timestamp | first NON-DEGRADED contextful use (controller marks after the LLM result) | operator metrics | unrelayed persists; degraded reply ⇒ retry next call | with note | relay marks exactly once per note; degraded reply leaves it pending (tests) |

## Failure modes

| Scenario | Behavior |
| --- | --- |
| Invalid/expired parent token | Uniform 404 (no oracle) — H5 shows the warm re-request guidance |
| Notes table down | Reads/lessons unaffected; note write 503 with gentle copy; relay skipped, traced |
| Unsafe note text | 400 at the boundary, never stored, traced (`parent_note_rejected` cause=safety_filtered — cause/ids only, never the text); parent-facing copy stays gentle |
| Child not this parent's | 404 (scope join) — never an existence oracle across families |

## Validation & preflight

- Scope test: parent A's token cannot read parent B's child (404, no oracle).
- DENY serialization tests: timeline + works responses carry no transcripts/episodes/
  aiParams/base_canon/internal ids.
- Note lifecycle test: stored (reviewed) → injected once (`【爸爸妈妈想对你说】` in the
  context block) → `relayed_at` set after a non-degraded reply → not re-injected; a
  DEGRADED reply leaves it pending (retried next call).
- Banned-wording on all parent-H5 copy (the existing rule extends).
- Deploy preflight (exposure — mirrors parent-share.md v1.4): from outside the operator
  network, `GET /parent/children` serves with a valid token and uniform-404s without one;
  `POST /parents/<id>/access` (the mint) is blocked.
- Scrub-on-mount test (v1.1): after the H5 renders, the address bar retains `?parent=`
  presence but NOT the token value; the children fetch still carries the captured token.
- Mid-session-death tests (v1.1): a 404 on note POST / timeline renders the re-request
  guidance (never 换个说法/休息一下); a 400 on note POST renders the gentle rewording copy.

## Changelog

- **v1.2** (2026-06-10, lead-serialized with the agent-session.md freeze): the playground
  UNLOCK MINT (`POST /parent/children/:id/playground-session`) becomes the second parent
  write — it mints a SEPARATE token class (`playground_session_tokens`: one student,
  playground scope, session TTL; agent-session.md owns it). The v1.1 rule stands: token-
  class risk acceptances never transfer between classes by implementation — the new class
  carries its own transport ruling in agent-session.md.

- **v1.1** (2026-06-10, lead-serialized after the Step-3 adversarial review): the H5
  entry route `?parent=<token>` is now contract-named, and the share token's
  history-persistence acceptance explicitly does NOT transfer to this token class
  (180-day, all-children, write-capable — a materially larger blast radius must not
  inherit a weaker token's risk acceptance by implementation). Binding mitigations:
  no-referrer meta + scrub-on-mount. Mid-session uniform 404 ⇒ re-request guidance on
  every surface (the failure-modes row was previously honored only by the initial fetch).
- **v1** (2026-06-10): initial freeze — parent access token (capability machinery,
  SMS/WeChat mint later behind the same seam), scoped authenticated reads, growth
  timeline projection, co-working v1 = the relayed parent note. Converged pre-merge with
  the adversarial review: relay marks moved to the CONTROLLER after a non-degraded reply
  (a build-time mark lost notes under gateway fallback), exposure rule serialized into
  parent-share.md v1.4 (not asserted unilaterally here), exact trace reasons named,
  timeline lineage works carry DENY-scrubbed contentJson like the share view.

_Parent Surface Contract · Phase 6 · Frozen v1.2 · 2026-06-12_
