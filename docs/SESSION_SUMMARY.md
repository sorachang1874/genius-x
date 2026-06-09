# Session Summary: Scalable Architecture v2.0 Documentation

**Date**: 2026-06-08
**Session goal**: Design scalable architecture and update all project documentation before next code-heavy implementation session

---

## What was accomplished

### ✅ 1. Scalable Architecture v2.0 designed (1,344 lines)

**Document**: `docs/architecture/scalable-architecture-v2.md`

Comprehensive forward-looking architecture to evolve from classroom-centric ephemeral MVP to student-centric persistent platform supporting:
- Persistent student identity (parent enrollment before class)
- Student workspaces (works, interactions, memories persist)
- AI agents with long-term memory (co-evolve across lessons)
- Parent co-working (view + interact at home)
- Tool-calling framework (children discover/call tools to create IPs)
- Rich media pipeline (images, videos, 3D printable models)
- Multi-city deployment (20-30 students/classroom premium model, tenant isolation)

### ✅ 2. Playbook integration completed

**Source**: `ai-assisted-engineering-playbook` (commit `5228b8d`)

Reviewed latest playbook version and incorporated new principles:
- User-invisible fallback must stay operator-visible
- Model output is a contract (prompt versioning, schema validation)
- Independent review gates for design/implementation/adoption
- Phase registry and artifact-first planning
- Schema and storage before code

### ✅ 3. All project documentation updated

**Updated documents**:

| Document | Changes |
|----------|---------|
| `AGENTS.md` | Added Phase 1+ ownership map (agents G-K), updated hard rules with playbook principles |
| `PROGRESS.md` | Rewritten with Architecture v2.0 status, 8-phase roadmap, updated test coverage |
| `docs/contracts/README.md` | Added Phase 1-8 contracts roadmap, contract freeze protocol |
| `docs/DEFERRED.md` | Added Phase 1-8 deferrals ledger (DF-v2-1 through DF-v2-10) |
| `docs/NEXT_SESSION.md` | **New**: Architecture summary, phase roadmap, next session priorities |
| `docs/agents/briefs/Phase1-identity-enrollment.md` | **New**: Phase 1 implementation brief, ready for coding |
| `docs/contracts/identity.md` | **New**: Identity contract (Student, Parent, Tenant, GuardianConsent) |

### ✅ 4. Phase 1 implementation brief created

**Document**: `docs/agents/briefs/Phase1-identity-enrollment.md`

Ready-to-implement brief with:
- PostgreSQL schema (students, parents, tenants, guardian_consents)
- Identity Service API endpoints
- Classroom join migration strategy
- Tests to add
- Definition of Done checklist

### ✅ 5. Open decisions documented

**Location**: `docs/architecture/scalable-architecture-v2.md` §14

Documented 15 open decisions requiring product/technical alignment:
- Product: tool discovery UX, parent co-work scope, memory privacy
- Technical: service decomposition timing, vector DB choice, agent context caching
- Capacity: concurrent classroom target, AI cost per student, storage growth

---

## Key architectural decisions

### Service boundaries
Start as modular monolith (`apps/server/*`), extract when scale demands:
- Identity, Workspace, Agent, Content services
- Classroom service mostly unchanged (real-time WebSocket)
- AI Gateway extended with tool dispatch

### Storage architecture
- **Redis**: Hot classroom state, agent short-term memory (current + extensions)
- **PostgreSQL**: Student profiles, workspaces, memories (new, Phase 1+)
- **Object Storage**: Tencent COS for all media (new, Phase 2+)
- **Vector DB**: Optional pgvector or Pinecone (Phase 4+)

### AI Agent memory system
- **Short-term** (Redis): Recent 10 interactions
- **Long-term** (PostgreSQL): Importance-scored memories, decay over time
- **Context building**: Recent + important + task-relevant (not full history)

### Tool-calling framework
- Children **discover** tools organically (not admin-unlocked)
- Agent suggests tools based on current task and phase
- Tools are agents/models/workflows children call to create IPs
- Future: children combine tools into workflows

### Parent co-working
- **Phase 3**: Read-only H5 artifact (same as planned parent MVP)
- **Phase 6**: Parent-initiated interactions tagged differently
- Same workspace API, same agent, not separate product

---

## 8-Phase roadmap (6-7 months)

| Phase | Duration | Status | Key deliverables |
|-------|----------|--------|------------------|
| 1 | 2-3 weeks | 📋 Next | Identity & enrollment (PostgreSQL, persistent studentId) |
| 2 | 3-4 weeks | 📋 Planned | Workspace foundation (works, interactions, memories) |
| 3 | 2 weeks | 📋 Planned | Parent read-only artifact (H5, WeChat notification) |
| 4 | 4-5 weeks | 📋 Planned | Agent with memory (context builder, importance scoring) |
| 5 | 3-4 weeks | 📋 Planned | Tool-calling (registry, discovery UX, suggestions) |
| 6 | 3 weeks | 📋 Planned | Parent co-working (OAuth, parent-initiated interactions) |
| 7 | 4-5 weeks | 📋 Planned | Rich media (video/3D generation, async processing) |
| 8 | 2-3 weeks | 📋 Planned | Multi-city (tenant isolation, distributed locks) |

**Critical path**: Phases 1-3 enable parent feature scalability.

---

## Capacity confirmed

### Premium classroom capacity (20-30 students, 4-6 assistants, 1:5)
> Supersedes the old "60 students" — see `PREMIUM_CLASSROOM` in `packages/contracts/src/identity.ts`.
- **Redis**: ~1.5MB per session (trivial)
- **PostgreSQL**: ~3MB archived per class
- **Object Storage**: ~300MB per class
- **Compute**: 2-4 cores, 4-8GB RAM per classroom service instance

### Scale-out trigger
- Horizontal replicas when concurrent classrooms > 10
- Current architecture handles 100+ concurrent classrooms before clustering needed
- Distributed Redis locks replace in-process mutex for multi-instance

---

## Next session priorities

### Immediate tasks
1. **Review open decisions** (Architecture v2.0 §14) with product lead
2. **Freeze Phase 1 contracts** in `docs/contracts/` and `packages/contracts/src/`
3. **Implement Phase 1**: PostgreSQL schema, Identity Service, update classroom join
4. **Validate end-to-end**: parent enrolls → student joins → class runs → profile persists

### Contract-first protocol
Per playbook and `docs/agents/README.md`:
1. Lead freezes contracts before parallel work
2. Workers import contracts read-only
3. Contract changes re-serialized through lead

### Definition of Done (Phase 1)
- [ ] Contracts frozen (`identity.md`, `enrollment.md`, typed `identity.ts`)
- [ ] PostgreSQL schema applied, demo tenant seeded
- [ ] Identity Service API implemented and tested
- [ ] Classroom join updated to persistent studentId
- [ ] All tests green (unit + integration + e2e)
- [ ] End-to-end validated
- [ ] Docs updated (PROGRESS.md, DEFERRED.md)

---

## Files ready for next session

### Read first
1. `docs/NEXT_SESSION.md` — Architecture summary and next steps
2. `docs/architecture/scalable-architecture-v2.md` — Full design (1,344 lines)
3. `docs/agents/briefs/Phase1-identity-enrollment.md` — Implementation brief
4. `docs/contracts/identity.md` — Identity contract (draft)

### Updated references
- `AGENTS.md` — Updated ownership map
- `PROGRESS.md` — Updated status and roadmap
- `docs/contracts/README.md` — Updated contract registry
- `docs/DEFERRED.md` — Updated deferrals ledger

---

## Status at session end

**Architecture**: ✅ Complete (v2.0 designed, documented, reviewed)
**Playbook**: ✅ Latest version integrated
**Documentation**: ✅ All documents updated
**Phase 1 prep**: ✅ Implementation brief ready
**Contracts**: 🔄 Draft (ready for freeze)
**Implementation**: 📋 Ready to begin

---

_Session completed: 2026-06-08_
_Next milestone: Phase 1 — Identity & Enrollment (2-3 weeks)_
