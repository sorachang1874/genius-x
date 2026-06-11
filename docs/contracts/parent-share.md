# Parent Share Contract (Phase 3)

**Status**: Frozen v1.5 (v1.4 + the playground route family — see Changelog)
**Owner**: Parent surfaces (Agent K) · share service in `apps/server/src/share`
**Phase**: Phase 3 — Parent read-only artifact
**Typed realization**: `packages/contracts/src/parent-share.ts`
**Companion contracts**: [`workspace.md`](workspace.md) (the works this filters),
[`identity.md`](identity.md), [`data-and-privacy.md`](data-and-privacy.md),
[`parent-surface.md`](parent-surface.md) (the Phase-6 authenticated surface — amends the exposure rule)
**Last updated**: 2026-06-10

---

## Purpose

The parent's **first product surface**: after class, a read-only H5 (capability URL) shows
the child's birth certificate and works. This is the retention/referral moment — and the
strictest privacy boundary in the system (an UNAUTHENTICATED link that must leak nothing
beyond the curated artifact).

---

## Scope

In scope (Phase 3):
- Share token lifecycle (mint at lesson end, expiry, uniform 404)
- `GET /share/:token` → `ParentShareView` (privacy-filtered)
- Parent H5 (`apps/web/src/parent`, `?share=<token>` route)
- Notification **seam** (operator-visible; console default)

Out of scope (deferred):
- ❌ Real WeChat template messages — needs 微信资质 (business dependency); the seam is in
  place, the default sink prints the link for the operator to send manually
- ❌ Parent accounts/auth (Better Auth), parent-initiated anything (Phase 6)
- ❌ Live workspace browsing — the view stays bounded to ONE (student, lesson) pair.
  **Semantics: live read at open time** (not a frozen snapshot): the view serves whatever
  works exist for that pair when the link is opened, so works that land after mint (late
  processing, a re-run of the same lesson inside the 90-day window) appear. The leak
  boundary is the (student, lesson) scope, not the mint timestamp.
- ❌ Token revocation UI (admin deletes the row; UI later)

---

## The capability model (no-auth access, made safe)

| Property | Rule |
| --- | --- |
| Token | 256-bit `randomBytes`, base64url (43 chars). Unguessable; the URL IS the credential |
| Storage | **sha256 hash only** — a DB leak does not leak working links |
| Raw token exposure | Exactly once, in `MintShareResult`; **never stored, never logged** (logs/traces carry a hash prefix at most) |
| Expiry | 90 days from mint (re-mint on demand re-issues a NEW token; old ones keep working until expiry) |
| Invalid access | **Uniform 404** for unknown/expired/revoked/malformed-but-shaped — no oracle distinguishing "never existed" from "expired" |
| Transport | HTTPS-only in operator deployments (capability URLs must not transit plaintext); same CORS posture as the rest. The H5 sets `<meta name="referrer" content="no-referrer">` — the token rides in the query string and legacy WeChat/X5 webviews can leak full URLs in `Referer` to cross-origin media. Token persistence in browser history is ACCEPTED (the link is re-openable by design) |
| Scope | ONE (student, lesson) pair per token — a leaked link exposes one lesson's artifact of one child, nothing else |

---

## Deployment exposure rule (BINDING)

The internet-facing routes are `GET /share/:token` (Phase 3), the token-gated
`GET/POST /parent/*` family (Phase 6, [`parent-surface.md`](parent-surface.md) — amended
into this rule v1.4), and the token-gated `GET/POST /playground/*` family (APP
integration, [`agent-session.md`](agent-session.md) — amended in v1.5: ALL child-at-home
traffic — session lifecycle, world-object reads, theme packs, future turn traffic — rides
the playground session token under this prefix ONLY, never the operator-posture
endpoints); everything else on the server (identity admin, workspace reads, `/session/*`)
is unauthenticated child PII at operator posture. The postures share one Fastify
listener, so **exposure is enforced at the proxy**:

> The internet-facing reverse proxy forwards **exactly** `GET /share/*`, token-gated
> `GET/POST /parent/*` (parent-surface.md), token-gated `GET/POST /playground/*`
> (agent-session.md), and the static H5 (the web bundle). **Every other server path is
> denied from outside the operator network.** Without a proxy, the server binds to the
> operator LAN only — never directly to the internet.

Example nginx allowlist:

```nginx
location ~ ^/share/      { proxy_pass http://geniusx-server:3000; }  # capability link (Phase 3)
location ~ ^/parent/     { proxy_pass http://geniusx-server:3000; }  # token-gated parent surface (Phase 6)
location ~ ^/playground/ { proxy_pass http://geniusx-server:3000; }  # token-gated child-at-home surface (APP integration)
location /               { root /srv/geniusx-web; try_files $uri /index.html; }  # static H5
# NO other proxy_pass: /students, /parents (NB: ^/parent/ does NOT match /parents/ — the
# operator MINT stays unreachable), /admin, /session, /socket.io stay denied from outside
```

Code keeps the postures explicit: `registerPublicShareRoute` (public GET only) vs
`registerOperatorShareRoutes` (mint, identity-admin posture). A process-enforced split
(second listener serving only the public route) is DF-v2-16. **Deploy preflight**: from
outside the operator network, `curl https://<public>/students/<any>` and
`curl https://<public>/session/x/state` must be blocked (proxy 403/404), while
`GET /share/<token>` serves.

---

## Privacy filter (the DENY list — tested, not aspirational)

`ParentShareView` carries: `studentDisplayName`, `lessonId`, `certificate` (the birth
certificate's `contentJson`), filtered `works`, `sharedAt`, `expiresAt`. **It must never
carry**:

- ❌ interaction records / transcripts (raw words a child said are not parent-browsable)
- ❌ `aiParams` / `degraded` / `sessionId` / `stageId` (operator metadata)
- ❌ `studentId` / `tenantId` / `parentId` / work `id`s (internal identifiers)
- ❌ raw memory rows (memories appear only as the certificate's curated `{label, value}`)
- ❌ **episodic memories (`key="episode"`), raw OR curated** — not parent-served pending a
  founder decision on scene-content visibility; see `agent-context.md` §Episodic memory.
  (A "curated summary" is still a child's private scene content until decided otherwise.)
- ❌ any "AI/Prompt/LLM/token/model" wording in H5 copy (friend, not model — all surfaces)

A serialization test asserts the response JSON contains none of the denied keys.

**`works.contentJson` is parent-visible by definition** (it ships verbatim in this view):
every writer (today: the controller's `buildWorkContent`; later: Agent J's content
pipeline) must keep it free of operator metadata and internal identifiers. Defense in
depth: the share service **deep-scrubs** the served copy of the denied keys above and
logs an operator-visible `[share-scrub]` warning when anything is dropped (a drop firing
means a writer broke this rule — never a silent filter). The scrub covers JSON **keys**;
URL **values** (`contentUrl`/`thumbnailUrl`/`avatarUrl`) pass through verbatim — see the
preflight below binding the content pipeline.

---

## Owner matrix

| Field | Owner | Source of truth | Allowed values | Derivation | Consumers | Fallback | Deletion condition | Preflight |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `share_tokens.token_hash` | Share Service | `share_tokens` table | sha256 hex | hash(raw token) at mint | `GET /share/:token` | none | row deleted on revoke; purge after expiry+30d (**implemented**: traced boot-time sweep, `purgeExpired()`; a scheduled job replaces it later) | no plaintext-looking values (length=64 hex) |
| `share_tokens.expires_at` | Share Service | table | mint+90d | mint time | view gate | none | with row | served shares all have `expires_at > NOW()` (app-tested) |
| `share_tokens(student_id, tenant_id)` | Share Service | composite FK → `students(id, tenant_id)` | valid student | derived at mint | isolation | none — mint rejected | with row | FK enforced |
| `ParentShareView.certificate` | Share Service | newest `birth_certificate` work's `contentJson` | render-ready JSON | workspace read, filtered | H5 hero card | absent when none | n/a | DENY-list serialization test |
| `ParentShareView.works` | Share Service | workspace works — **CURATED (v1.3, decision ②): latest Work per artifact type** (the "每课精选" finals; iteration history collapses behind `iterations`) | `SharedWork[]` | latest-per-type projection | H5 gallery | empty list | n/a | DENY-list serialization test |
| `ParentShareView.iterations` (v1.3) | Share Service | per artifact type with > 1 completion: `{type, total, slices}` — `slices` = up to 4 EVENLY-SAMPLED drafts oldest→newest (e.g. 1/15→6/15→11/15→15/15), each privacy-filtered like a `SharedWork` | additive array | sampled projection | H5 expandable container (打磨轨迹) | absent when no type iterates | n/a | DENY-list test covers slices too |
| Notification seam | Share Service | `NotificationSink` (server) | fire-and-forget, **sync or async** (`void \| Promise<void>`) | called after mint; carries `studentId` (operator surface — disambiguation) + `hasArtifacts` (hollow-link flag) | operator (console default) → WeChat later | failure traced, never blocks — **including async rejections** (swallowed; an async sink must never die as an unhandledRejection) | n/a | mint succeeds even when sink throws OR rejects (both tested) |

---

## Lifecycle

1. **Lesson end** (same hook as the profile write-back): for each attending student, the
   controller mints a share token (fire-and-forget; failure = operator trace, lesson
   unaffected) and hands the link to the `NotificationSink`. A student with **zero
   completed artifact stages** still gets a link (live-read: works may land later), but it
   is flagged `hasArtifacts:false` in BOTH the `share_mint_ok` trace and the sink info —
   the operator never forwards an empty page unknowingly.
2. **Default sink (Phase 3)**: logs the capability URL operator-visibly — the operator
   sends it to the parent (print/IM). The WeChat template-message sink replaces it when
   资质 lands; the seam's failure mode is shadow-grade (sink down ⇒ classroom unaffected,
   link retrievable via the admin tool).
3. **Re-mint / retrieval**: `tools/parent-link.mjs --student <id> [--lesson <id>]` calls
   `POST /students/:id/share` (operator posture — same trust level as the identity admin
   endpoints, never internet-exposed; see the Deployment exposure rule) and prints the
   link. The mint response carries the **server-composed `url`** (the server's
   `WEB_BASE_URL` is the single URL composer); the tool's `WEB_URL` env is an explicit
   override only. NOTE: mint maps an unknown student to `400 INVALID_INPUT` (not the
   identity endpoints' `404 STUDENT_NOT_FOUND`) — intentional while the v1 `ShareErrorCode`
   enum is frozen; revisit at the next contract rev.
4. **Parent opens H5**: `GET /share/:token` → filtered view; H5 renders certificate hero +
   works gallery + warm copy. Expired/unknown → the H5 shows a warm "链接过期了，请联系
   老师获取新链接" (no error codes parent-facing). **Empty view** (no certificate, no
   renderable works — contract-enumerated legitimate state) renders warm "作品还在路上"
   copy, never a blank page.

---

## Failure modes

| Scenario | Behavior | Recovery |
| --- | --- | --- |
| Unknown/expired/revoked/malformed token | **Uniform `404 SHARE_NOT_FOUND`** | Operator re-mints via the admin tool |
| Mint fails at lesson end (DB blip) | `share_mint_failed` trace; lesson + write-back unaffected | Admin tool re-mints |
| Notification sink throws | `share_notify_failed` trace; mint still succeeds | Operator pulls the link from the tool |
| Workspace empty (no works yet) | View serves with empty `works`, no certificate | — (legitimate state) |
| Share service absent (no DB) | Endpoints not registered (404), loud boot warning — same deployment mode as identity/workspace | Deployment fix |

---

## Validation & preflight

- Token shape at the boundary: base64url, length 43 → else `400 INVALID_INPUT` (uniform
  404 applies to well-formed-but-unknown).
- DENY-list serialization test: the JSON of a real served view contains none of
  `aiParams|degraded|sessionId|stageId|studentId|tenantId|parentId` keys.
- **URL values must not embed internal ids** (binding on Agent J's content pipeline): the
  scrub covers JSON keys, not URL values — a media pipeline keying object paths by
  student/session (`cos://bucket/<sessionId>/<studentId>/…`) would hand internal ids to
  parents verbatim. Preflight (expect 0):
  ```sql
  SELECT COUNT(*) FROM works w
  WHERE w.content_url LIKE '%' || w.student_id::text || '%'
     OR (w.session_id IS NOT NULL AND w.content_url LIKE '%' || w.session_id || '%');
  ```
- Deploy preflight (exposure rule): from outside the operator network,
  `/students/<any>`, `/session/x/state`, and `POST /parents/<any>/access` (the operator
  mint) blocked; `GET /share/<token>` serves; `GET /parent/children` serves with a valid
  parent token and uniform-404s without one; `/playground/*` serves with a valid
  playground session token and uniform-404s without one.
- ```sql
  -- All tokens reference valid students (FK enforces; drift check — expect 0)
  SELECT COUNT(*) FROM share_tokens WHERE student_id NOT IN (SELECT id FROM students);
  -- Hashes only (no raw-token-looking values; sha256 hex = 64 chars)
  SELECT COUNT(*) FROM share_tokens WHERE length(token_hash) != 64;
  -- Retention (expiry+30d purge; boot sweep keeps this 0)
  SELECT COUNT(*) FROM share_tokens WHERE expires_at < NOW() - INTERVAL '30 days';
  ```

---

## Changelog

- **v1.5** (2026-06-10, lead-serialized with the agent-session.md freeze): the BINDING
  exposure rule gains token-gated `GET/POST /playground/*` as the THIRD internet-facing
  route family — the child-at-home playground surface (agent-session.md). Same review
  class as v1.4: without this rev a deploy following this allowlist blocks the entire
  playground (child-visible breakage at home), and one following agent-session.md widens
  the proxy ad-hoc over operator-posture child-PII endpoints.

- **v1.4** (2026-06-10, lead-serialized with the Phase-6 parent-surface freeze): the
  BINDING exposure rule gains token-gated `GET/POST /parent/*` (parent-surface.md) as the
  second internet-facing route family; nginx example + deploy preflight updated (the
  `^/parent/` location does not match `/parents/` — the operator mint stays denied).
  Without this rev, a deploy following this contract's allowlist blocks the entire Phase-6
  parent surface, while one following parent-surface.md violates this binding text
  (the review-caught cross-contract divergence).
- **v1.3** (2026-06-10, lead-serialized with Phase 4.5 — coupled to workspace.md v1.2's
  one-Work-per-completion-EVENT rev, decision ② three-layer browse): the gallery becomes
  CURATED (latest Work per artifact type = the 每课精选 finals); the additive
  `iterations` field carries up to 4 evenly-sampled drafts per iterating type (the
  打磨轨迹 the parent expands); full history stays a Phase-6 authenticated surface.
  Without this rev, every-iteration recording would flood the gallery with drafts.
- **v1.2** (2026-06-09, lead-serialized with the Phase-4 contract freeze): episodic
  memories (`key="episode"`) added to the DENY list — raw or curated, not parent-served
  pending the founder's scene-content-visibility decision (agent-context.md). The DENY-list
  serialization test gains an `episode` assertion when Phase 6 parent reads expand.
- **v1.1** (2026-06-09, lead-serialized after the Phase-3 adversarial security review):
  Deployment exposure rule (BINDING) added; notification seam allows async sinks with
  rejection-swallowing + carries `studentId`/`hasArtifacts`; certificate derivation
  decoupled from the works recency window (independent query); `contentJson` declared
  parent-visible + served copy deep-scrubbed (traced); live-read semantics documented
  (replaces "snapshot" wording); expiry+30d purge implemented (boot sweep); referrer
  posture; URL-value preflight; mint 400-posture note; H5 empty state.
- **v1** (2026-06-09): initial freeze.

_Parent Share Contract · Phase 3 · Frozen v1.1 · 2026-06-09_
