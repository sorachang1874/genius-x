> **HISTORICAL — superseded.** Phase 1 was completed 2026-06-09; see PROGRESS.md and docs/migration/mvp-to-phase1.md. Kept for planning history only.

# 🚀 START PROMPT FOR NEXT SESSION (Phase 1 Implementation)

Copy and paste this prompt to start Phase 1 implementation in your next Claude Code session:

---

I'm starting Phase 1 implementation for Genius X: **Identity & Enrollment** (persistent student identity).

**What I need you to do**:
1. Read the Phase 1 handbook: `docs/agents/briefs/PHASE1_HANDBOOK.md`
2. Review the identity contract: `docs/contracts/identity.md`
3. Follow the 7-step implementation sequence in the handbook
4. Start with Step 1: Freeze contracts before writing any code

**Critical context**:
- This is a **premium service model**: 20-30 students per classroom with 4-6 assistants (1:5 ratio)
- Students currently ephemeral (room-code join) → need persistent identity via parent enrollment
- Contract-first approach: freeze `identity.md` and `enrollment.md` before implementing
- Target: 2-3 weeks, 7 implementation steps

**Hard rules from AGENTS.md**:
- No child-facing "Prompt/LLM/token/AI" wording
- No visible child failure state
- User-invisible fallback must stay operator-visible
- Contract-first development (no hidden fallbacks)
- Shadow systems (auth, CMS) remain pluggable

**Implementation sequence**:
1. **Freeze contracts** (identity.md, enrollment.md, typed contracts)
2. **PostgreSQL schema** (migrations, seed demo tenant)
3. **Identity Service** (create/read/update students/parents/tenants)
4. **HTTP API** (expose Identity Service endpoints)
5. **Update classroom join** (use persistent studentId, validate tenant)
6. **E2E validation** (enroll → join → class → profile persists)
7. **Documentation** (update PROGRESS.md, DEFERRED.md)

**Start with**:
- Review `docs/contracts/identity.md` (already drafted)
- Create `docs/contracts/enrollment.md` (enrollment flow contract)
- Create typed contracts in `packages/contracts/src/identity.ts`
- Ask me to review contracts before proceeding to implementation

**Key documents to reference**:
- `docs/agents/briefs/PHASE1_HANDBOOK.md` — your guide
- `docs/contracts/identity.md` — identity contract (Student, Parent, Tenant)
- `docs/architecture/scalable-architecture-v2.md` §2.2 — data models
- `AGENTS.md` — ownership map and rules

**Definition of Done**: All 7 steps complete, tests green, docs updated, end-to-end validated.

Let's start with Step 1: reviewing and freezing the contracts. Please read the handbook first and confirm you understand the implementation sequence.

---

# Alternative shorter prompt (if you want to dive in faster):

I'm implementing Phase 1 (Identity & Enrollment) for Genius X. Read `docs/agents/briefs/PHASE1_HANDBOOK.md` and start with Step 1: freeze contracts. Premium service model: 20-30 students, 4-6 assistants (1:5 ratio). Contract-first approach per AGENTS.md. Let's begin.

---

**Tips for the next session**:
- Ask Claude to read the handbook first before making any changes
- Review contracts together before freezing them
- Run tests frequently (after each step)
- Update PROGRESS.md as you complete each step
- Don't skip the contract freeze step (most important!)

**If you need to clarify anything during Phase 1**:
- Open decisions are documented in `docs/architecture/scalable-architecture-v2.md` §14
- Check troubleshooting section in handbook if tests fail
- Tenant isolation is critical — validate with preflight queries

Good luck with Phase 1! 🎉
