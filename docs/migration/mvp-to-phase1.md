# Migration guide: MVP → Phase 1 (persistent identity)

**Status**: Complete (2026-06-09)
**Contracts**: `docs/contracts/identity.md` + `enrollment.md` (frozen v1)

## What changed

| | MVP | Phase 1 |
| --- | --- | --- |
| Student identity | Ephemeral `randomUUID()` minted on join | Permanent UUID from **parent enrollment** (PostgreSQL) |
| Classroom join | Any room code + typed name | Room code + **persistent `studentId`** (enrollment link/QR `?studentId=`) |
| Display name | Typed by the child at join | From the enrolled profile (client input ignored) |
| After class | Everything lost with Redis | `completedLessonIds` + companion fields (avatar, birth speech) **written back to the profile** |
| WS resume | `HELLO` minted unknown students | Unknown students **denied** (operator-visible `join_rejected` trace) |
| Failure account | — | Every refused join logged + counted; child sees a warm non-failure |

**No dual path**: an un-enrolled student cannot enter. MVP demo sessions are simply
re-created with the seeded students; there was no production data to backfill (clean slate
per the frozen migration strategy).

## Operator runbook

```bash
# 1. One-time: database up + schema + demo students (小明/朵朵/轩轩/乐乐)
docker compose up -d postgres
DATABASE_URL=postgres://geniusx:geniusx@localhost:5432/geniusx \
  pnpm --filter @genius-x/server migrate:seed

# 2. Run the demo (defaults DATABASE_URL to the compose DB, prints enrollment links)
./demo-start.sh

# 3. Enroll a real student (idempotent on the parent's phone; prints the child's link)
node tools/enroll-student.mjs --name 小美 --age 6 --phone +8613800001234 --room demo-1
```

**Production additions** (`GENIUS_X_MODE=live|production`):
- `DATABASE_URL` **required** (boot preflight pings it; fatal if unreachable)
- `TENANT_ID` **required** (UUID, must exist in `tenants`; fatal otherwise — the demo
  tenant default is dev-only)
- Pin `CORS_ORIGIN`; identity endpoints are unauthenticated until Phase 3 — never
  internet-expose them (operator-bounded deployment)
- `enroll-student.mjs`: pass `--tenant $TENANT_ID` (the demo-tenant default exists only in dev)

## Failure modes (operator view)

| Symptom | Meaning | Where it shows |
| --- | --- | --- |
| Child sees "请老师来帮帮忙" | Join refused (stale/wrong QR, wrong tenant, DB down) | `[HTTP] student join refused` log + `join_rejected` trace (counted) |
| 503 IDENTITY_UNAVAILABLE | DB down / not configured — **new joins only**; a running class is unaffected | boot warning / join logs |
| `profile_writeback_failed` trace | Lesson completed but profile write failed (e.g. DB blip at closure) | TraceSink; recover with the idempotent SQL below |
| Runner aborts "EDITED after being applied" | Someone changed an applied migration | author a new `NNN_*.sql` instead |

**Recovery for a failed write-back** (idempotent — safe to re-run; fill in the ids from the
trace payload):

```bash
docker compose exec -T postgres psql -U geniusx -d geniusx -c "
UPDATE students SET
  completed_lesson_ids = CASE WHEN 'lesson-001' = ANY(completed_lesson_ids)
                              THEN completed_lesson_ids
                              ELSE array_append(completed_lesson_ids, 'lesson-001') END,
  updated_at = NOW()
WHERE id = '<studentId from the trace>';"
```

Known window (tracked as DF-v2-13): a server crash BETWEEN the closure transition and the
fire-and-forget write-back loses the completion with no trace — recover with the same SQL
using the class roster.

## What did NOT change

- Assistants/teachers still join ephemerally (no persistent identity until their phase).
- The classroom runtime (Redis sessions, reducer, WS sync) is untouched mid-class — identity
  is consulted at **join** and written at **lesson end** only.

## Divergences & semantics (lead-serialized)

- **Lesson-end (not stage-level) companion writes**: identity.md's lifecycle sketches
  stage-level `geniusX` writes; Phase 1 writes them once at lesson end (single DB
  touchpoint, classroom isolation). Consequence: a class aborted before the final stage
  loses that lesson's companion fields. Documented deferral DF-v2-14 — per-stage writes
  arrive naturally with the Phase 2 workspace (which writes artifacts per stage anyway).
  A LATE-resolving birth speech (slow generation racing the closure transition) is handled:
  a supplemental idempotent write fires when the prepare lands at the final stage.
- **Completion = attendance**: every student present in the session when the class reaches
  the final stage gets the lesson recorded in `completedLessonIds` — attendance semantics,
  not per-stage participation. Downstream consumers (badges, certificates) should not read
  it as "completed every activity".
- **Degraded content is marked**: if the persisted birth speech came from a fallback line,
  the `profile_writeback_ok` trace carries `degraded: true` (and `birthdaySpeechMissing`/
  `avatarUrlMissing` flag absent fields) — never a silent normal path.
- Shadow systems (Payload/Better Auth/Langfuse/promptfoo) remain pluggable and absent.

## Verification

`identity-classroom.e2e.test.ts` runs the whole loop in CI (enroll → join → full lesson over
real HTTP+WS → profile persisted + write-back failure isolation). The real-DB equivalent was
smoke-tested against compose postgres:16 (seeded 小明 + freshly enrolled students).
