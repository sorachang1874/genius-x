> **HISTORICAL — superseded.** Phase 1 was completed 2026-06-09; see PROGRESS.md and docs/migration/mvp-to-phase1.md. Kept for planning history only.

# Architecture Summary for Next Session

## What was designed

**Scalable Architecture v2.0** — comprehensive forward-looking design (1,344 lines) to evolve from classroom-centric ephemeral MVP to student-centric persistent platform.

Full document: `docs/architecture/scalable-architecture-v2.md`

---

## Key architectural shifts

### From MVP (classroom-centric)
- Ephemeral students (room-code join → lost after class)
- Session state in Redis, expires
- AI serves lesson flow only
- No parent access
- No cross-lesson memory

### To v2.0 (student-centric)
- **Persistent identity**: parent enrollment creates permanent studentId before class
- **Student workspace**: works, interactions, memories persist across lessons
- **AI agent with long-term memory**: learns from child, co-evolves across lessons
- **Parent co-working**: view workspace, initiate interactions at home
- **Tool-calling**: children discover/call tools (models/agents/workflows) to create IPs
- **Rich media**: images, videos, 3D printable models, physical souvenirs
- **Multi-city**: 20-30 students/classroom (premium model), distributed deployment, tenant isolation

---

## Service boundaries (modular monolith → microservices)

Start as modules in `apps/server`, extract when scale demands:

1. **Identity Service** — student/parent enrollment, persistent identity, tenant management
2. **Classroom Service** — real-time WebSocket sync (MVP, mostly unchanged)
3. **Workspace Service** — persistent portfolio (works, interactions, memories), HTTP REST
4. **Agent Service** — context building, memory retrieval, tool suggestions
5. **Content Service** — async media pipeline, object storage, CDN delivery
6. **AI Gateway** — extended with tool dispatch, memory-augmented prompts (current + additions)

---

## Storage architecture

| Tier | Technology | Purpose |
|------|------------|---------|
| **Redis** | Current + extensions | Hot classroom state, agent short-term memory |
| **PostgreSQL** | New (Phase 1+) | Student profiles, workspaces, long-term memories, tool registry |
| **Object Storage** | New (Phase 2+) | Tencent COS for all media, CDN delivery |
| **Vector DB** | Optional (Phase 4+) | pgvector or Pinecone for semantic memory search |

---

## Phase roadmap (6-7 months)

| Phase | Focus | Duration | Key deliverables |
|-------|-------|----------|------------------|
| **Phase 1** | Identity & enrollment | 2-3 weeks | PostgreSQL schema, parent/student/tenant API, persistent studentId |
| **Phase 2** | Workspace foundation | 3-4 weeks | Works, interactions, memories persistence, object storage integration |
| **Phase 3** | Parent read-only | 2 weeks | Parent share artifact, H5 view, WeChat notification |
| **Phase 4** | Agent with memory | 4-5 weeks | Context builder, importance-scored memories, memory retrieval |
| **Phase 5** | Tool-calling | 3-4 weeks | Tool registry, discovery UX, agent suggestions |
| **Phase 6** | Parent co-working | 3 weeks | WeChat OAuth, parent-initiated interactions |
| **Phase 7** | Rich media | 4-5 weeks | Video/3D generation, async processing |
| **Phase 8** | Multi-city | 2-3 weeks | Tenant isolation, distributed locks, regional deployment |

**Critical path**: Phases 1-3 (identity + workspace + parent) make parent feature scalable.

---

## AI Agent memory system design

### Short-term memory (Redis)
- Recent 10 interactions
- Current task context
- Active tools in session

### Long-term memory (PostgreSQL)
- Importance-scored memories (0-1 scale)
- Memories decay over time unless accessed
- Optional embeddings for semantic retrieval

### Context building strategy
When agent responds to child:
1. **Recent**: last 10 interactions
2. **Important**: high-importance memories (>0.7)
3. **Relevant**: semantic search if task-specific
4. **Profile**: creativity profile (strengths, interests, pace)
5. **Tools**: currently available tools

**Key insight**: Don't send full workspace history (token explosion). Build smart context from: recent + important + task-relevant.

---

## Tool-calling framework

### Discovery flow
```
Child encounters scenario → Agent suggests tool → Child calls tool → Tool added to workspace
```

Tools are **not unlocked by admin**; they're **discovered organically** through agent suggestions based on current task and phase.

### Example tools
- 画画助手 (image generation)
- 声音魔法 (voice cloning)
- 故事编织机 (story co-creation)
- 立体创造 (3D models)
- 记忆宝盒 (search past works)
- 技能图书馆 (download workflows)

Future: children **combine tools into workflows**.

---

## Parent co-working design

### Phase 3: Read-only
- Parent receives WeChat notification after class
- Opens H5 → sees works, birth certificate, progress
- Same artifact approach as planned parent MVP

### Phase 6: Co-working
- Parent initiates: "我们一起给你的好朋友编个新故事吧"
- Interaction recorded with `initiatedBy: "parent"`
- Agent builds context: child's memories + parent co-work mode
- Output becomes work tagged `parent_co_created`
- Next classroom: agent remembers "上次你和爸爸/妈妈一起..."

**Key insight**: Parent co-working is a new interaction type, not a separate product. Same workspace API, same agent, tagged differently.

---

## Capacity planning (premium model: 20-30 students, 4-6 assistants, 1:5)

> Superseded the old "60 students" model — see `PREMIUM_CLASSROOM` in
> `packages/contracts/src/identity.ts` (single source of truth).

### Single classroom (sized at the 30-student max)
- 30 students × 50KB state = ~1.5MB Redis (trivial)
- 30 students × 100 interactions × 1KB = ~3MB PostgreSQL archived
- 30 students × 5 works × 2MB = ~300MB object storage

### Scale-out
- Redis + PostgreSQL handle 100+ concurrent classrooms before clustering needed
- Horizontal replicas when concurrent classrooms > 10
- Distributed Redis locks replace in-process mutex for multi-instance

---

## Updated documents

✅ **Architecture**:
- `docs/architecture/scalable-architecture-v2.md` (new, 1,344 lines)

✅ **Contracts**:
- `docs/contracts/README.md` (updated with Phase 1-8 contract roadmap)

✅ **Agent rules**:
- `AGENTS.md` (updated ownership map with Phase 1+ services, added playbook principles)

✅ **Progress tracking**:
- `PROGRESS.md` (rewritten with Architecture v2.0 status, phase roadmap)
- `docs/DEFERRED.md` (added Phase 1-8 deferrals ledger)

✅ **Implementation briefs**:
- `docs/agents/briefs/Phase1-identity-enrollment.md` (new, ready for implementation)

✅ **Playbook integration**:
- Latest `ai-assisted-engineering-playbook` reviewed (commit `5228b8d`)
- Incorporated principles:
  - User-invisible fallback must stay operator-visible
  - Model output is a contract (prompt versioning, schema validation)
  - Independent review gates for design/implementation/adoption
  - Phase registry and artifact-first planning

---

## Open decisions documented (Architecture v2.0 §14)

### Product decisions
1. Tool discovery UX (persistent "工具箱" vs in-context suggestions only)
2. Parent co-work scope (supervised only vs parent solo access)
3. Memory privacy (can children mark memories private from parents?)
4. Physical souvenirs (which works are 3D-printable, fulfillment partner model)
5. Tool combination timing (when do children combine tools into workflows)

### Technical decisions
1. Service decomposition timing (modular monolith first vs immediate extraction)
2. Vector DB choice (pgvector simplicity vs Pinecone scale)
3. Agent context caching (cache in Redis vs rebuild each time)
4. Tool execution isolation (in-process vs worker pool)
5. WeChat integration (native miniapp vs H5 with auth wrapper)

### Capacity and cost
1. Concurrent classroom target (10? 50? 100?)
2. AI cost per student with agent memory and tool-calling
3. Storage growth and retention policy impact on cost

---

## Next session priorities

### Immediate next steps
1. **Review open decisions** with product lead (Architecture v2.0 §14)
2. **Create Phase 1 contracts**: `identity.md`, `enrollment.md` in `docs/contracts/`
3. **Create Phase 1 typed contracts**: `identity.ts`, `enrollment.ts` in `packages/contracts/src/`
4. **Implement Phase 1**: PostgreSQL schema, Identity Service API, update classroom join
5. **Validate**: End-to-end parent enrolls → student joins → class runs → profile persists

### Contract-first protocol
Per `docs/agents/README.md` and playbook:
1. Lead agent freezes contracts before parallel work
2. Workers import contracts read-only
3. Contract changes re-serialized through lead

### Definition of Done (Phase 1)
- [ ] Contracts frozen
- [ ] PostgreSQL schema applied
- [ ] Identity Service implemented and tested
- [ ] Classroom join updated to persistent studentId
- [ ] All tests green
- [ ] End-to-end validated
- [ ] Docs updated

---

## Recommended session workflow

1. **Start with contract review** — finalize `identity.md`, `enrollment.md`
2. **PostgreSQL schema first** — apply schema, seed demo tenant
3. **Identity Service implementation** — API endpoints + tests
4. **Update classroom join** — persistent studentId lookup
5. **End-to-end validation** — full enrollment → classroom flow

Do not skip contract freeze or schema-first steps per playbook principles.

---

_Architecture v2.0 complete · Phase 1 ready for implementation_
_Last updated: 2026-06-08_
