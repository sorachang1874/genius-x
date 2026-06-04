# Design Note: M4 — Talent + Memory · Birth (pre-gen + 伙伴出生证) · Closure · Projection

> Status: **proposed, v7 (hardened per six Codex passes — 7+6+3+4+1+1 findings folded in)**. Layer-2 gate.
> Cross-owner milestone, lead-coordinated. Sequenced **contracts-first**: the contracts-v1.4
> amendment (§A) is authored/frozen by the lead + reviewed BEFORE implementation fans out
> (AGENTS.md: contracts freeze before fan-out). Owners: contracts/lead (E), course runtime (C),
> ai-gateway (D — surface already exists), student UI (B), assistant/projection UI (A). Builds on
> M3 (`apps/web`) + M2 (gateway + interaction lifecycle). Deferrals: `docs/DEFERRED.md` (DF-M4-*).

> **Child-facing wording (hard rule).** The certificate is called **「伙伴出生证」** in ALL
> child-facing UI — never "AI 出生证" (the product/rundown uses "AI 出生证" as internal shorthand
> only). No "AI / 大模型 / 人工智能 / Prompt / LLM / token / model" in any child string; the
> banned-wording test is extended to every new M4 view.

## Goal / scope (M4)

Finish Lesson 1 end-to-end. M3 runs stages 1–2 (intro → icebreak → shape); M4 adds:

- **Stage 3 — 才艺互动 (talent):** 4–5 option cards → AI reply with a "反问埋点" → the child's
  voice answer becomes content AND is **invisibly mined for memories + a personality tag**
  (`extractMemory`). Gate: `allStudents{ minInteractions:2 }` (already in config/reducer).
- **Stage 4 — 诞生礼 (birth):** at birth-unlock the server **pre-generates** each child's 专属台词
  (once that child's memories have settled — B2) so the on-stage moment is **instant**
  ("一键触发…完全不需要开口"); the child taps one big button → plays the prepared speech → the
  **伙伴出生证** view appears.
- **Stage 5 — 收束 (closure):** teacher flips the whole class to a summary screen with the
  certificate docked.
- **Teacher projection:** `REQUEST_PROJECTION` → the big screen shows + plays the projected
  child's certificate/speech during the 诞生礼.

Out of scope (later): parent H5 + report (M5); real Tencent providers + 天御 (M6); GeniusX
**naming** (Lesson 2 / D2 open); physical certificate printing (ops).

## The reconciliation that shapes this milestone

The on-stage moment must be **instant and zero-pressure** (Erikson 认可 need; rundown §诞生礼:
press once, only a "极短的音效准备动画"). A child tapping "play" then waiting 8–15s for LLM+TTS
would break it. So the speech is **pre-generated at birth-unlock** (per student, once that
student's memories are settled — B2), surfaced with `AI_READY`, and replayed on tap via a new
`playPrepared` input. Birth-unlock fires minutes before any individual child is called up, so
pre-gen (seconds/student) is long done by tap time; the play button is **gated on `AI_READY`** and
the teacher/projection roster shows a per-child **readiness indicator** so no child is ever called
before their speech is prepared. This is the one genuinely new mechanic and it drives most of
contracts-v1.4.

Degradation principle binds: if pre-generation degrades, the child still gets a positive台词
(a preset friendly line) — invisibly — while operators see `degraded:true` in the stored
prepared entry + traces (AGENTS.md). Same for memory extraction + projection (below).

---

## A. contracts-v1.4 amendment (lead-authored, frozen before fan-out)

All in `@genius-x/contracts` (+ a `@genius-x/course-config` schema add). Each field below states
owner / source-of-truth / allowed-values / derivation / fallback / consumers, per AGENTS.md
contract discipline; `tsc` is the preflight, reducer guards + the Zod validator are the runtime twin.

### A1. Pre-generated outputs are first-class (student.ts)

A server-derived opaque id + a typed stored entry (NOT a bare `ClientAiOutput`, so metadata for
idempotency, degradation, and the certificate lives with it):

```ts
export type PreparedOutputId = string; // opaque, server-minted, validated against you.prepared

export interface PreparedOutput {
  stageId: StageId;          // stage this was prepared for (e.g. birth)
  outputKind: OutputKind;    // "audio" | "text" | "images" — server-owned, NOT client-supplied
  ready: boolean;            // false = minted+generating; true = output filled (gates AI_READY/play)
  output: ClientAiOutput;    // child-renderable (text/audioUrl) — refs only, no raw bytes; {} until ready
  degraded: boolean;         // operator-visible: was this a fallback line?
  preparedAt: string;        // ISO (passed in; not generated in pure contract code)
}
```

- **Owner/SoT — single, atomic:** the **reducer mints `preparedId`** when it emits `CALL_PREPARE`
  (inside the store.update), recording a `prepared[preparedId] = {…, output:{}, ready:false}`
  placeholder; the runner only *fills* that entry via `PREPARE_DONE` (it never mints). This is the
  one owner (Codex re-review #2) — A5/B2 below follow it.
- **Deletion:** lives for the session; archived/cleared with it. **Idempotency:** `playPrepared`
  reads it any number of times; replay is safe. **Readiness:** `AI_READY` is emitted only after
  `PREPARE_DONE` flips `ready:true`.

### A2. `StudentRuntimeState` += `displayName`, `memories`, `prepared` (student.ts)

Engine-owned typed fields (NOT config-declared outputs):

```ts
displayName?: string;                          // from /session/join name; for the certificate
memories: Record<MemoryKey, string>;           // invisibly collected in talent; keys ∈ declaredMemoryKeys
pendingMemory: string[];                        // interactionIds with an outstanding extraction; [] = settled
prepared: Record<PreparedOutputId, PreparedOutput>; // server pre-generated (e.g. birth speech)
```

- `displayName`: set at join (the join request already accepts `name?`); resolves Codex #5
  (the certificate needs a name and `you` had none).
- `memories`: written by the reducer on `MEMORY_EXTRACTION_DONE` (A5). Key MUST be in
  `declaredMemoryKeys` (validator fails closed; invalid/null → dropped + traced, never a failure).
- `pendingMemory`: reducer-owned **set of interactionIds** with an outstanding extraction —
  an id is added when an extracting talent INTERACT is accepted (B1), removed (idempotently — a
  duplicate/late `MEMORY_EXTRACTION_DONE` for an absent id is a no-op) on its
  `MEMORY_EXTRACTION_DONE` (incl. null/timeout). **Empty ⇒ memories settled** — the gate for birth
  pre-generation (B2), so the speech is never built from incomplete memories.
- `prepared`: written by the reducer on `PREPARE_DONE` (A5); read by `playPrepared`. **At most one
  birth `preparedId` per student** (single pre-gen at birth-unlock — B2; no regeneration → no
  stale-id problem).
- **Resume:** all three ride in `RESUME_STATE.you`, so a reconnect mid-birth restores the play
  button + the whole certificate from authoritative state (M3 render-from-`you` rule). This makes
  **A4 (certificate-from-state)** actually sufficient — `you` now carries name + memories +
  prepared; labels come from config (A6).

### A3. `InteractionInput` += `playPrepared` (ws-events.ts)

```ts
| { kind: "playPrepared"; preparedId: PreparedOutputId } // birth: replay a pre-generated output
```

- **No `outputKind` on the input** (Codex #2): the server derives it from
  `you.prepared[preparedId].outputKind`. **Producer:** birth screen's big play button.
- **Server handling:** NOT a fresh AI call — returns the **stored** `output` as `AI_OUTPUT`.
  Validated like any INTERACT (current stage + `preparedId` exists **AND
  `you.prepared[preparedId].ready === true`**). Not-ready (the `ready:false` placeholder) /
  missing / stale → trace + drop, **never** emit an empty `AI_OUTPUT` — so `AI_READY` is a real
  server gate, not just a UI hint, and the child can never see a blank.

### A4. `AI_READY` = prepared-ready signal (ws-events.ts)

Replace the placeholder M2 shape with a clean prepared-ready message:

```ts
| { type: "AI_READY"; studentId: string; stageId: StageId; preparedId: PreparedOutputId; outputKind: OutputKind }
```

- **Meaning:** "a pre-generated `outputKind` is ready; replay it with `playPrepared{preparedId}`."
- **Consumer:** birth screen enables the play button on receipt (until then: "preparing…"
  thinking, never blank). Projection roster marks the child **ready**.

### A4b. `REQUEST_PROJECTION` += requester identity (ws-events.ts, Codex re-review #4)

`REQUEST_PROJECTION` carries only `studentId`, and the controller has no connection-role context,
so a student-origin projection request can't be distinguished. Add a control-surface identity so
it's at least typed + trace-able:

```ts
| { type: "REQUEST_PROJECTION"; studentId: string; requestedBy: string } // assistant/teacher id
```

- **Now:** the server validates `requestedBy` looks like a control-surface id and traces
  student-origin attempts (consistent with the v1.2 role note — role is still message/identity-
  derived, not cryptographically enforced). **Full enforcement = Better Auth (DF-8).** A cleaner
  alternative (passing the socket's handshake role into `controller.onMessage`) is noted for the
  auth milestone; M4 takes the typed-field route to avoid a transport refactor now.

### A5. `engine.ts` — decouple memory + add the prepare lifecycle

Memory extraction is **folded into the existing talent interaction runner** (it reuses the ASR
transcript that runner already produced — there is NO separate extract command, so nothing needs a
transcript before ASR exists). It still **never delays the child-facing reply** (Codex #4: the
reply `AI_OUTPUT` is emitted as soon as llm/tts complete) and is **reducer-tracked** so birth
pre-gen can gate on it being settled (Codex re-review #1):

```ts
// EngineEvent (fed back by the interaction runner, separately from INTERACTION_DONE)
| { type: "MEMORY_EXTRACTION_DONE"; studentId; stageId; interactionId; memory?: { key: MemoryKey; value: string } }
| { type: "PREPARE_DONE"; studentId; stageId; preparedId: PreparedOutputId; output: ClientAiOutput; outputKind: OutputKind; degraded: boolean }
// EngineCommand
| { type: "CALL_PREPARE"; studentId; stageId; preparedId: PreparedOutputId; promptVersion: string; outputKind: OutputKind }
```

- Reducer stays **single writer**:
  - On accepting a talent `INTERACT` whose stage interaction has `memoryExtraction:true` AND whose
    `input.kind ∈ {voice, talentAnswer}` (i.e. carries audio → will yield a transcript to mine;
    a pure `talentOption` pick has nothing to extract), it adds `interactionId` to `pendingMemory`
    while emitting the usual `CALL_INTERACTION`. The runner reuses that interaction's ASR transcript
    for `extractMemory` after the reply — no second ASR, no extra command.
  - `MEMORY_EXTRACTION_DONE` → remove `interactionId` from `pendingMemory` (idempotent — absent id
    is a no-op, guarding duplicate/late events); if `memory` present + key valid →
    `you.memories[key]=value` (invalid/absent → no write, traced). Then run `maybePrepareBirth` (B2).
  - When pre-generating (B2) the reducer **mints `preparedId`**, writes the `ready:false`
    placeholder, and emits `CALL_PREPARE{preparedId, promptVersion, outputKind}` (read from the
    `birth_speech` config — A6). `PREPARE_DONE` → fills `you.prepared[preparedId]` (`ready:true`).
- The interaction runner (one per `CALL_INTERACTION`) calls the gateway OUTSIDE the mutex, feeds
  `INTERACTION_DONE` (reply) and, for extracting talent inputs, `MEMORY_EXTRACTION_DONE` (reusing
  the ASR transcript); the prepare runner feeds `PREPARE_DONE`. Controller emits `AI_READY` once ready.

### A6. Memory schema + certificate labels (course-config.ts + lesson-001)

Codex #6: the rundown needs **1 personality tag + 3 memories**, `declaredMemoryKeys` lacks
personality/background, and `extractMemory` returns **one** `{key,value}` per call. Resolution:

- **Decision (Codex re-review #5 — no longer open):** each talent turn extracts **at most one**
  memory (no gateway change); over `minInteractions:2`–`maxInteractions:3` turns the student
  accumulates up to 2–3 memories. There is **no hard count requirement**: the certificate renders
  **whatever labeled memories are present** (1–3) and never errors on fewer — the rundown's "1 tag
  + 3 memories" is a target, not a gate. A **personality tag** is one declared key
  (`personality_tag`), extracted the same way (best-effort); **background_setting** is sourced from
  shape B-line answers when present, else extracted in talent. Add `personality_tag`,
  `background_setting` to `declaredMemoryKeys`, and **bump `lessonConfigVersion`**.
- **`birth_speech` interaction gains an explicit `outputKind`** (Codex re-review #3): the config
  must declare what a prepared output is, not have the server assume it. Extend the interaction:

```ts
export interface BirthSpeechInteraction {
  type: "birth_speech";
  promptTemplate: string;
  outputKind: OutputKind; // what pre-generation produces (Lesson 1: "audio")
}
```

  `CALL_PREPARE.promptVersion`/`outputKind` are read from here (generic — keyed off interaction
  *type*, not stage *id*); lesson-001's birth interaction sets `outputKind:"audio"`.
- Add **config-driven labels/roles** so the certificate is generic (no hardcoded key→label in the
  client). Extend `LessonConfig`:

```ts
/** Per-memory display metadata for certificate/report rendering. Generic; keys ∈ declaredMemoryKeys. */
certificate?: { memoryLabels: Record<MemoryKey, string>; order?: MemoryKey[] };
```

The 伙伴出生证 view renders `you.memories` via `lessonConfig.certificate.memoryLabels` (with a
neutral default label if a key is unlabelled — never an error).

### contracts-v1.4 change set (summary)

**TS contracts** — `student.ts`: `PreparedOutputId` + `PreparedOutput` (incl. `ready`);
`StudentRuntimeState` += `displayName?`, `memories`, `pendingMemory`, `prepared`. `ws-events.ts`:
`InteractionInput` += `playPrepared{preparedId}`; `AI_READY` → prepared-ready shape;
`REQUEST_PROJECTION` += `requestedBy`. `engine.ts`: + `MEMORY_EXTRACTION_DONE`, `PREPARE_DONE`
events, + `CALL_PREPARE` command (memory extraction reuses the existing `CALL_INTERACTION` runner —
no new extract command). `course-config.ts`:
`BirthSpeechInteraction` += `outputKind`; + `certificate` block. `lesson-001`: +2 memory keys +
labels + birth `outputKind:"audio"` + `lessonConfigVersion` bump. `freshStudentState()` (server +
web fixture) += `memories:{}`, `pendingMemory:[]`, `prepared:{}`. No change to
`AI_OUTPUT`/`ClientAiOutput`, `PROJECT`, or `STAGE_COMPLETE`.

**Prose contracts (Codex re-review #6 — required before fan-out, same PR):** update
`docs/contracts/course-engine.md` (AI_READY/playPrepared/CALL_PREPARE/MEMORY_EXTRACTION_DONE, projection
validation — drop "AI_READY is M4/future"), `docs/contracts/client-server.md` (AI_READY + playPrepared
in the steady-state loop; requestedBy), and `docs/contracts/data-and-privacy.md` (retention/deletion
for `memories` + `prepared` — derived signals only, refs not bytes). Tag `contracts-v1.4`.

---

## B. Server (Agent C) — `apps/server`

Generic-engine rule holds: behavior keys off the stage's `interaction.type` + config flags, never
a stage **id**.

### B1. Talent → memory extraction (non-blocking)

The talent interaction is `multimodal_talent` with `memoryExtraction:true`. The reply path is
unchanged: deliver the child reply (`AI_OUTPUT`) **as soon as** asr→llm→tts completes (Codex #4: do
not gate the reply on extraction). For an audio-bearing input (`voice`/`talentAnswer`) the same
runner then **reuses the ASR transcript it already produced** to run a timeout-bounded
`gateway.extractMemory({ transcript, allowedKeys: lesson.declaredMemoryKeys, … })` (no second ASR,
no `talentOption` extraction — there's no audio) and **always** feeds `MEMORY_EXTRACTION_DONE` back
— with `memory` on a valid key, or **without** on null/invalid/timeout (so the interactionId always
clears from `pendingMemory`; the no-memory case is trace-only, no write, no classroom effect). No
raw audio crosses the boundary — the runner holds the transcript transiently (privacy contract).

### B2. Birth pre-generation + `playPrepared` (instant on-stage)

- **Trigger = birth-unlock, deferred until memories settled** (Codex #3 + re-review #1/#2):
  pre-generation is a property of the **`birth_speech` interaction capability** (looked up by
  interaction *type*, not stage id). It is **wanted** when birth unlocks — at which point talent
  is fully over (the `talent→birth` gate already required `allStudents{minInteractions}`), so **no
  new** talent interactions or extractions can start; `pendingMemory` only drains. The reducer runs
  one shared predicate **`maybePrepareBirth(student)`** = (birth current/unlocked) ∧ (no birth
  `prepared` yet) ∧ (`pendingMemory` empty), re-evaluated at **birth-unlock AND each
  `MEMORY_EXTRACTION_DONE` drain**; on the first true it mints the `preparedId` + placeholder and
  emits `CALL_PREPARE`. **`pendingMemory` empty subsumes "no pending talent interaction"** (impl
  decision, M4a): only audio inputs (voice/talentAnswer) feed the speech and every one is tracked
  in `pendingMemory` (seeded at INTERACT, drained at MEMORY_EXTRACTION_DONE even when the reply went
  stale); a pending `talentOption` adds no memory, so it can't change the speech — and gating on it
  would strand pre-gen (a stale interaction is cleared controller-side with no reducer event).
  **No regeneration, exactly one `preparedId` per student** → no stale/superseded id to play or project.
  - **Why this is still instant on-stage:** birth-unlock begins the 诞生礼 phase; the teacher gives
    a ~2-min intro and children are called **one at a time** over ~12 min. Pre-gen (seconds/student)
    completes long before anyone taps; the play button is **`AI_READY`-gated** and the projection
    roster shows per-child readiness, so no child is called before their speech exists. The child's
    tap→play is instant because the output is already stored.
- `CALL_PREPARE` carries `promptVersion` + `outputKind` (from the `birth_speech` config, A6) + the
  reducer-minted `preparedId`. The runner assembles the prompt from `promptVersion` + the student's
  settled `memories` (+ `displayName`), calls `gateway.llm` then `gateway.tts`, builds
  `ClientAiOutput {text,audioUrl}`, feeds `PREPARE_DONE{degraded}` → reducer fills the entry
  (`ready:true`) → controller emits `AI_READY`.
  - Degrade: gateway fallback → preset friendly台词, `degraded:true` (operator-visible); the child
    still gets `AI_READY` + a positive line.
- `INTERACT{playPrepared, preparedId}` → validate (current stage + `preparedId ∈ you.prepared`
  **AND `.ready === true`**) → emit the stored `AI_OUTPUT` (idempotent, replayable); a not-ready
  placeholder is traced + dropped, never an empty output. Birth→closure gate stays
  `STUDENT_COMPLETE{done}` (sent after first successful play).
- The play button is enabled **only** after `AI_READY`; a child whose speech isn't ready yet shows
  "preparing…" — and is not callable on stage (the roster readiness, B3).

### B3. Projection delivery (validated + readiness, Codex #7)

`REQUEST_PROJECTION{studentId, requestedBy}` → server **validates**: `requestedBy` is a
control-surface id (student-origin requests denied + traced — A4b; full RBAC = Better Auth/DF-8),
the current stage allows projection, and the child's birth output is **ready** (`you.prepared[*]`
with `ready:true`). Valid → emit `PROJECT{studentId, output}` (the prepared speech) to the session
room. Not-authorized / missing / stale / not-ready → trace (operator-visible), and the teacher's
roster shows that child as **not ready** so they aren't called up — never a child-facing failure.
The projection screen renders the projected child's certificate from the read model + plays
`output`. `PROJECT` schema unchanged.

### B4. Closure

`TEACHER_UNLOCK{closure}` already advances (config: teacher/immediate). Closure is a client view;
optionally the teacher flips `GLOBAL`→`synced` for the whole-class summary moment.

### B5. e2e smoke (fakes) — extends the M1 socket smoke

talent (2× INTERACT; reply arrives BEFORE memory is written; `MEMORY_EXTRACTION_DONE` drains
`pendingMemory` + populates `you.memories`) → birth unlock → once `pendingMemory` is empty, `AI_READY`
arrives (prepared stored) → `playPrepared` replays the prepared `AI_OUTPUT` → `STAGE_COMPLETE done`
→ `REQUEST_PROJECTION{studentId, requestedBy}` (PROJECT received; a student-origin or not-ready
request is traced + dropped) → closure. Assert reply-not-blocked-by-extraction, `pendingMemory`
drains, memories/prepared/displayName in `you`, AI_READY before any play, **an early
`playPrepared` (before `ready:true`) emits nothing** (no blank), idempotent replay,
projection auth/readiness validation, machine advances regardless of AI degradation.

---

## C. Frontend (Agents B + A) — `apps/web`

Stage routing stays presentation-only (M3); ids/variants/outputs/labels read from config.

### C1. Talent stage (`student/stages/Talent.tsx`, Agent B)

Render the `multimodal_talent` `options` as 4–5 child-safe cards (icons + labels; banned-wording
test extended). Tap → `INTERACT{talentOption}` → thinking → play reply (ai-output port). If the
reply is a "反问", reuse M3 hold-to-talk → `INTERACT{talentAnswer, audioRef}` (M3 pending-guard
prevents double-send). Progress hint from `you.interactionCounts[talent]` vs config
`minInteractions` (no hardcoded number).

### C2. Birth stage (`student/stages/Birth.tsx`, Agent B)

- Pre-`AI_READY`: "正在准备你的惊喜… ✨" (thinking, never blank).
- On `AI_READY{preparedId}`: a single big **播放专属语音** button → `INTERACT{playPrepared,preparedId}`
  → AI_OUTPUT plays (audio-or-speak). Replayable.
- After first play: render **「伙伴出生证」** assembled from `you` — avatar (`outputs.avatarUrl`),
  闪光记忆点 (`you.memories` via `lessonConfig.certificate.memoryLabels`), 性格标签/背景设定 (declared
  memory keys), speech text, `you.displayName`. Plain/functional visuals (DF-M3-7 carries over).

### C3. Closure (`student/stages/Closure.tsx`, Agent B)

Whole-class summary view with the certificate docked (互动三问 are teacher-led; no app logic).

### C4. Teacher / projection screen (`screen/`, Agent A)

A thin `?role=teacher` (or `screen`) view: joins the session, shows the class roster with each
child's **readiness** (ready once their `AI_READY`/prepared exists), lets the teacher
`REQUEST_PROJECTION{studentId, requestedBy}` for the on-stage child, and on `PROJECT` renders that child's
伙伴出生证 full-screen + plays the speech. **In M4** (founder decision): a thin version — single
projected child, manual trigger; richer multi-pad UX later (DF-M4-4).

### C5. Tests (Vitest + fake socket/session — M3 harness)

Talent: option/voice dispatch the right INTERACT; progress from counts; reply plays. Birth:
AI_READY enables play; `playPrepared{preparedId}` (no outputKind) dispatched; certificate
assembles from `you.memories`+`outputs.avatarUrl`+`displayName`+config labels; resume mid-birth
restores it. Closure renders. Banned-wording scan extended (incl. "伙伴出生证", never "AI"). Session
reducer: `AI_READY` marks prepared-ready; memories/prepared/displayName survive `RESUME_STATE`.

---

## D. Suggested split (mirrors M2a/M2b)

- **M4a — contracts-v1.4 + server (lead + C; D's `extractMemory`/`llm`/`tts` already exist):**
  the §A amendment (frozen + reviewed first), then §B wiring + B5 e2e on fakes. No frontend.
- **M4b — frontend (B + A):** §C stages + projection screen + tests, against the frozen v1.4
  contracts and the M4a server.

Each on its own worktree+branch+PR; contract freeze gates the fan-out.

## E. Deferrals (to add to docs/DEFERRED.md)

- **DF-M4-1** Birth speech TTS = placeholder audioUrl (real TTS = M6; client prefers audioUrl).
- **DF-M4-2** Talent "反问埋点" prompt/话术树 = a small fixed set in the prompt template; full
  4–5-option induction tree (rundown 待确认) is later prompt-design work.
- **DF-M4-3** `personality_tag`/`background_setting` modelled as declared memory keys (A6);
  background sourced from shape B-line when present, else talent.
- **DF-M4-4** Teacher/projection screen ships **in M4** but thin (single projected child, manual
  trigger); richer multi-pad projection UX is the later enhancement.
- **DF-M4-5** Persisted `BirthCertificate` artifact (archive/print/parent report) = M5; M4 ships
  the live client-assembled view only.
- **DF-M4-6** GeniusX naming deferred to Lesson 2 (D2); certificate name field may be blank.

## F. Review asks (remaining open decisions — the rest are now decided above)

1. **A1/A2 prepared shape** — `PreparedOutput` in runtime state vs on `GeniusX`/an artifact.
   (Proposed: runtime state, archived with session.)
2. ~~**C4 projection scope**~~ — DECIDED (founder): a thin teacher/projection screen ships in M4
   (M4a server `REQUEST_PROJECTION`/`PROJECT` + M4b screen); richer UX later (DF-M4-4).
3. **A2 displayName** on `StudentRuntimeState` (proposed) vs a separate profile read-model
   surfaced in resume — preference?

> Decided in v3 (were open): memory cardinality (certificate renders available labeled memories,
> no hard count — A6); pre-gen trigger (birth-unlock, deferred via `maybePrepareBirth` until
> memories settled; one preparedId, no regeneration — B2);
> `preparedId` ownership (reducer mints atomically — A1); `outputKind` source (`birth_speech`
> config — A6); projection identity (`requestedBy` + trace, full RBAC = DF-8 — A4b); prose
> `docs/contracts/` updates included in the change set.
