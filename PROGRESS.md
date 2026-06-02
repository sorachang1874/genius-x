# PROGRESS

## Last updated

2026-06-03

## Current state

**M1 complete.** Backend course engine works end-to-end in logic: generic config-driven
reducer + guards + Zod validator (PR #1) + Socket.IO classroom sync + atomic session store +
resume (PR #2). 42/42 server tests green on main. Contracts at `contracts-v1.1` (+`v1.2`
TEACHER_UNLOCK). No frontend and no AI content yet.

Done: scaffolding · playbook · build-vs-reuse · multi-agent protocol + standing Codex review
gate · GitHub remote + CI (typecheck+tests) · contracts v1.1 · docker-compose · runtime
config · fake-provider harness skeleton · **M1 engine (reducer/guards/validator/sync/store/resume)**.

Process note: every contract + code change went through Claude+Codex cross-model review
(NO-GO→GO loops). It repeatedly caught real bugs (privacy hole, enum leaks, write races,
broadcast-before-persist). Keep using it.

## Next

E-M1 (end-to-end smoke with fake providers) → M2 (AI gateway + fakes wired to
`CALL_INTERACTION`) → M3/M4 (frontend `apps/web` + AI content) = the path to a demo.

## Open risks / deferred

- `apps/web` is empty — the frontend is the largest gap to a visual demo.
- `CALL_INTERACTION` is a no-op until M2 — no AI content is produced yet.
- In-process session mutex = single-instance only (multi-instance → Redis lock later).
- Real Tencent providers deferred (D3); demo uses fakes. China: author offshore, run in China.

## Handoff — next agent starts here (E-M1, Agent E)

1. Read: `docs/agents/README.md`, `docs/architecture/lesson-runtime.md`, `apps/server/src/*`.
2. Build a scripted end-to-end smoke: boot the server (in-memory store), a Socket.IO test
   client + HTTP join, drive Lesson 1 intro→closure via the wire, assert sync + resume.
3. Branch + PR + Codex review; never auto-merge.
