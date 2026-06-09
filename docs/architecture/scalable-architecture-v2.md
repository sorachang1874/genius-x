# Genius X · Scalable Architecture v2.0

> **Purpose**: Forward-looking architecture design to support student-centric persistent workspaces, personal AI agents with memory, parent co-working, rich media capabilities, and multi-city deployment.
>
> **Status**: Design phase — this document defines the target architecture before implementation.
>
> **Author context**: Product vision from Manifesto + Lesson 1 MVP baseline + new requirements: persistent student workspaces, AI agents that co-evolve with children, tool-calling framework, parent co-working, multi-city scale, rich media (images/videos/3D models).

---

## 0. Design Principles

### 0.1 Evolution from MVP

The current MVP is **classroom-centric and ephemeral**:
- Students join with room codes → ephemeral `studentId`
- Class session in Redis → lost after class
- AI interactions serve the lesson flow, not a persistent agent

The target architecture is **student-centric and persistent**:
- Students have permanent identities and workspaces
- AI agents remember and co-evolve across lessons
- Parents can view/co-work with children after class
- All works and interactions become the child's creative portfolio

**Key constraint**: Build the scalable foundation now, but implement incrementally. Don't over-architect; don't under-architect.

### 0.2 Hard product rules (unchanged)

From Manifesto and AGENTS.md:

1. **Immersive, not instructional** — no quiz/test logic
2. **Use AI, don't teach AI** — no child-facing Prompt/LLM/token/AI wording
3. **No visible child failure state** — every input gets positive output
4. **Latency dressed as thinking** — animation + warm copy, never blank wait
5. **Fallback invisible to child, visible to operators** — degradation must be logged/counted
6. **Shadow systems pluggable** — CMS/Auth/Langfuse/promptfoo never block classroom

### 0.3 New architectural requirements

1. **Persistent student identity** — parent enrollment creates student profile before first class
2. **Student workspace** — personal space for works, interactions, memories, tools
3. **AI agent with memory** — learns from child's input/output/behavior/interest, co-evolves
4. **Tool-calling framework** — children call models/endpoints/agents to create IPs (images, voices, backgrounds, contexts)
5. **Parent co-working** — parents view and interact with child's workspace at home
6. **Rich media pipeline** — images, videos, 3D printable models, physical souvenirs
7. **Multi-city deployment** — 20-30 student capacity per classroom (premium model), distributed across cities
8. **Cloud-native scale** — horizontal scaling, distributed computing, fine-grained service isolation

---

## 1. Conceptual Model: Bounded Contexts

The architecture separates concerns into **bounded contexts** with clear boundaries and contracts.

```
┌─────────────────────────────────────────────────────────────────────┐
│  1. IDENTITY & ENROLLMENT                                            │
│     Parent creates student profile → student gets persistent ID      │
│     Guardian consent, student metadata, tenant assignment            │
└─────────────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────────────┐
│  2. CLASSROOM RUNTIME (synchronous, real-time)                       │
│     Current MVP implementation — WebSocket coordination              │
│     Lesson state machine, assistant controls, projection             │
│     Writes artifacts → Student Workspace after each stage            │
└─────────────────────────────────────────────────────────────────────┘
                          ↓ writes artifacts
┌─────────────────────────────────────────────────────────────────────┐
│  3. STUDENT WORKSPACE (asynchronous, persistent)                     │
│     Student's creative portfolio: works, interactions, memories      │
│     Parent read/co-work access (scoped by guardian consent)          │
│     HTTP API, not WebSocket — scales independently of classroom      │
└─────────────────────────────────────────────────────────────────────┘
                          ↓ provides context
┌─────────────────────────────────────────────────────────────────────┐
│  4. STUDENT AGENT (personalized AI with long-term memory)            │
│     Per-student agent state, learns across lessons                   │
│     Context builder: recent + important + current task               │
│     Tool registry: children discover/call tools to solve problems    │
└─────────────────────────────────────────────────────────────────────┘
                          ↓ orchestrates
┌─────────────────────────────────────────────────────────────────────┐
│  5. CONTENT PIPELINE (media generation, storage, delivery)           │
│     Object storage (S3/Tencent COS) for all media                    │
│     CDN delivery                                                      │
│     Async media processing: image/video/3D model generation          │
└─────────────────────────────────────────────────────────────────────┘
                          ↓ uses
┌─────────────────────────────────────────────────────────────────────┐
│  6. AI GATEWAY (unchanged role, extended capabilities)               │
│     Safety, budget, provider routing, fallback, audit                │
│     Extended: tool-calling dispatch, memory retrieval integration    │
└─────────────────────────────────────────────────────────────────────┘
```

**Key insight**: Classroom runtime remains synchronous/real-time (current design is correct). Student workspace, agent, and content pipeline are **asynchronous** and can scale independently.

---

## 2. Data Architecture

### 2.1 Storage tier separation

```
┌──────────────────────────────────────────────────────────────────┐
│  Redis (hot state, ephemeral)                                     │
│  - Active classroom sessions (ClassSession)                       │
│  - Agent short-term memory (recent N interactions)                │
│  - TTS cache, rate-limit counters                                 │
│  TTL: session expires after class + 1 hour grace period           │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  PostgreSQL (persistent, queryable)                               │
│  - Student profiles, parent accounts, guardian consent            │
│  - Student workspace: works, interactions, memories               │
│  - Agent long-term memory (importance-scored, embeddings)         │
│  - Tool registry, tool usage history                              │
│  - Completed class session archives (after Redis expiry)          │
│  - Tenant/org/city metadata for multi-city deployment             │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Object Storage (S3 / Tencent COS)                                │
│  - All media: images, videos, 3D models, audio                    │
│  - CDN-backed URLs for delivery                                   │
│  - Tenant-isolated buckets for data residency                     │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  Vector DB (optional, if semantic search needed)                  │
│  - Student memory embeddings for semantic retrieval               │
│  - Tool/capability semantic search                                │
│  Only add if workspace grows large (100+ memories per student)    │
└──────────────────────────────────────────────────────────────────┘
```

### 2.2 Core data models

#### Student (persistent identity)

```typescript
interface Student {
  id: string;                    // UUID, permanent across all lessons
  tenantId: string;              // city/org/school (for multi-city isolation)
  displayName: string;
  age: number;
  enrolledAt: string;            // ISO timestamp
  parentId: string;              // links to Parent account
  guardianConsent: GuardianConsent;
  
  // Genius X companion state
  geniusX: {
    name?: string;               // confirmed in Lesson 2
    avatarUrl?: string;          // from Lesson 1 Shape stage
    personalityTag?: string;     // extracted during interactions
    backgroundSetting?: string;  // from Lesson 1 Shape stage
    birthdaySpeech?: string;     // from Lesson 1 Birth stage
  };
  
  // Progress tracking
  progress: {
    completedLessonIds: string[];
    currentPhase: number;        // 1-4 per Manifesto growth arc
    badges: string[];
  };
  
  // Agent state reference
  agentId: string;               // references StudentAgent
  
  createdAt: string;
  updatedAt: string;
}

interface GuardianConsent {
  consentGivenAt: string;
  consentVersion: string;        // track consent policy version
  dataRetentionAgreed: boolean;
  parentCoWorkAllowed: boolean;  // can parent initiate interactions?
  mediaUsageAllowed: boolean;    // can works be used for showcase/promotion?
}
```

#### Parent (linked to students)

```typescript
interface Parent {
  id: string;                    // UUID
  tenantId: string;
  wechatOpenId?: string;         // for WeChat miniapp integration
  phoneNumber?: string;          // optional, for SMS notifications
  studentIds: string[];          // children linked to this parent
  createdAt: string;
}
```

#### StudentWorkspace (persistent portfolio)

```typescript
interface StudentWorkspace {
  studentId: string;
  tenantId: string;
  
  works: Work[];                 // child's creative outputs
  interactions: Interaction[];   // full interaction history
  memories: Memory[];            // importance-scored memories
  tools: ToolUsage[];            // tools child has discovered/used
  
  updatedAt: string;
}

interface Work {
  id: string;
  studentId: string;
  type: "image" | "video" | "3d_model" | "audio" | "text" | "birth_certificate";
  contentUrl?: string;           // object storage URL
  contentText?: string;          // for text works
  thumbnailUrl?: string;         // for preview
  
  metadata: {
    lessonId: string;
    stageId: string;
    toolUsed?: string;           // which tool created this
    aiParams?: Record<string, unknown>; // prompts, model, etc (operator-visible)
    degraded: boolean;           // was fallback used?
  };
  
  createdAt: string;
  updatedAt: string;
}

interface Interaction {
  id: string;
  studentId: string;
  timestamp: string;
  
  context: {
    lessonId: string;
    stageId: string;
    sessionId?: string;          // null if after-class interaction
    initiatedBy: "student" | "parent"; // parent co-working interactions tagged
  };
  
  input: {
    type: "voice" | "text" | "doodle" | "choice" | "tool_call";
    contentRef?: string;         // object storage ref for voice/doodle (never raw data)
    text?: string;
    metadata?: Record<string, unknown>;
  };
  
  output: {
    type: "voice" | "text" | "image" | "video" | "work_created";
    contentRef?: string;
    text?: string;
    workId?: string;             // references Work if this interaction created one
    degraded: boolean;
  };
  
  // Memories extracted from this interaction (async, may be empty)
  memoriesExtracted: string[];   // memory IDs
}

interface Memory {
  id: string;
  studentId: string;
  key: string;                   // opaque memory key (lesson-declared)
  value: string;
  
  context: {
    lessonId: string;
    stageId: string;
    collectedAt: string;         // ISO timestamp
    sourceInteractionId?: string;
  };
  
  // Importance scoring for retrieval
  importance: number;            // 0-1, higher = more important
  embedding?: number[];          // optional semantic embedding for retrieval
  
  // Access count for importance decay
  lastAccessedAt: string;
  accessCount: number;
  
  createdAt: string;
}

interface ToolUsage {
  id: string;
  studentId: string;
  toolId: string;                // references Tool in registry
  
  usedAt: string;
  context: {
    lessonId?: string;
    stageId?: string;
    scenario?: string;           // what problem was child solving?
  };
  
  outcome: {
    success: boolean;
    workCreated?: string;        // Work ID if tool created an artifact
    childReflection?: string;    // optional: what child said about the result
  };
}
```

#### StudentAgent (per-student AI with memory)

```typescript
interface StudentAgent {
  id: string;
  studentId: string;
  tenantId: string;
  
  // Short-term memory (hot, in Redis)
  shortTermMemory: {
    recentInteractions: string[]; // last N interaction IDs (e.g. 10)
    currentTask?: string;          // what the child is currently doing
    activeTools: string[];         // tools in current session
  };
  
  // Long-term memory (persistent, in PostgreSQL)
  longTermMemory: {
    importantMemories: string[];   // high-importance memory IDs
    preferredTools: string[];      // tools child uses frequently
    creativityProfile: {
      strengths: string[];         // e.g. ["visual", "storytelling"]
      interests: string[];         // e.g. ["animals", "space", "music"]
      pace: "explorer" | "builder" | "thinker"; // interaction style
    };
  };
  
  // Agent configuration
  config: {
    contextWindowSize: number;     // how many interactions to include in context
    memoryRetrievalStrategy: "recent" | "important" | "semantic";
    toolSuggestionEnabled: boolean;
  };
  
  updatedAt: string;
}
```

#### Tool (tool registry for children)

```typescript
interface Tool {
  id: string;
  name: string;                  // child-facing name, e.g. "画画助手"
  description: string;           // what this tool does
  category: "image" | "voice" | "story" | "3d" | "workflow" | "skill";
  
  // When/how child discovers this tool
  discoveryCondition: {
    minAge?: number;
    requiredPhase?: number;      // Manifesto phases 1-4
    prerequisiteTools?: string[]; // must have used these first
    lessonContext?: string[];    // appears in these lessons
  };
  
  // Capability contract
  capability: {
    endpoint: string;            // AI gateway endpoint or workflow ID
    inputSchema: JSONSchema;
    outputSchema: JSONSchema;
    estimatedLatency: number;    // ms
    costTier: "low" | "medium" | "high";
  };
  
  // Child-facing UI
  icon: string;                  // icon URL
  examplePrompts: string[];      // suggestions for child
  
  // Shadow/experimental tools not yet shown to children
  status: "active" | "experimental" | "deprecated";
  
  createdAt: string;
  updatedAt: string;
}
```

---

## 3. Service Architecture

### 3.1 Service decomposition

```
┌─────────────────────────────────────────────────────────────────┐
│  API Gateway / Load Balancer                                     │
│  - Rate limiting, tenant routing, auth validation                │
└─────────────────────────────────────────────────────────────────┘
         │
         ├──────────────────────────────────────────────────────┐
         │                                                        │
┌────────▼───────────┐  ┌────────────────────┐  ┌───────────────▼──┐
│  Identity Service   │  │  Classroom Service │  │  Workspace Service│
│  (Enrollment, Auth) │  │  (Real-time sync)  │  │  (Portfolio CRUD) │
│                     │  │                    │  │                   │
│  - Parent signup    │  │  - WebSocket       │  │  - Works          │
│  - Student creation │  │  - Lesson state    │  │  - Interactions   │
│  - Guardian consent │  │  - Redis session   │  │  - Memories       │
│  - Tenant mgmt      │  │  - Current MVP     │  │  - HTTP REST API  │
│                     │  │                    │  │  - PostgreSQL     │
│  PostgreSQL         │  │  Redis             │  │  + Object Storage │
└─────────────────────┘  └────────────────────┘  └───────────────────┘
         │                        │                        │
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │  Agent Service              │
                    │  (Per-student AI memory)    │
                    │                             │
                    │  - Context builder          │
                    │  - Memory retrieval         │
                    │  - Tool suggestions         │
                    │                             │
                    │  Redis (short-term)         │
                    │  PostgreSQL (long-term)     │
                    │  Vector DB (optional)       │
                    └─────────────────────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │  Content Service            │
                    │  (Media pipeline)           │
                    │                             │
                    │  - Media upload             │
                    │  - Async processing         │
                    │  - CDN delivery             │
                    │                             │
                    │  Object Storage + Queue     │
                    └─────────────────────────────┘
                                  │
                    ┌─────────────▼──────────────┐
                    │  AI Gateway                 │
                    │  (Current implementation)   │
                    │                             │
                    │  Extended with:             │
                    │  - Tool dispatch            │
                    │  - Memory-augmented prompts │
                    │  - Workflow orchestration   │
                    └─────────────────────────────┘
```

### 3.2 Service contracts (new)

#### Identity Service API

```
POST   /parents                      Create parent account
POST   /students                     Enroll student (parent-initiated)
GET    /students/:id                 Get student profile
PATCH  /students/:id/consent         Update guardian consent
GET    /tenants/:id/students         List students in tenant (admin)
```

#### Workspace Service API

```
GET    /students/:id/workspace       Get full workspace
GET    /students/:id/works           List works (paginated)
POST   /students/:id/works           Create work (from classroom or parent co-work)
GET    /works/:id                    Get work detail
GET    /students/:id/interactions    List interactions (filtered, paginated)
POST   /students/:id/interactions    Record interaction (from classroom or parent)
GET    /students/:id/memories        List memories (importance-sorted)
GET    /students/:id/tools           List tools child has discovered/used
```

#### Agent Service API

```
POST   /students/:id/agent/context   Build context for current task
POST   /students/:id/agent/suggest   Suggest next tool/action
POST   /students/:id/agent/reflect   Update agent state after interaction
GET    /students/:id/agent/profile   Get creativity profile
```

#### Content Service API

```
POST   /upload                       Get presigned upload URL
POST   /process                      Submit media processing job
GET    /jobs/:id                     Check processing status
GET    /media/:id                    Get CDN URL
```

---

## 4. AI Agent Memory System

### 4.1 Design goals

1. **Learn from every interaction** — agent observes child's choices, interests, creative style
2. **Co-evolve across lessons** — agent remembers context from Lesson 1 in Lesson 10
3. **Smart context building** — don't send 1000 interactions to LLM; build relevant context
4. **Importance-based retrieval** — recent + important + task-relevant memories

### 4.2 Memory lifecycle

```
Child interacts in classroom or at home
    ↓
Interaction recorded in workspace
    ↓
Memory extraction (async, via AI Gateway)
    ↓ if successful
Memory stored with importance score
    ↓
Agent short-term memory updated (Redis)
    ↓ after session
Agent long-term memory consolidated (PostgreSQL)
    ↓ periodic
Low-importance memories decay or archive
```

### 4.3 Context building strategy

When agent needs to respond to child:

```typescript
function buildAgentContext(studentId: string, currentTask: string): Context {
  // 1. Recent interactions (last 5-10)
  const recent = await getRecentInteractions(studentId, limit: 10);
  
  // 2. High-importance memories
  const important = await getMemories(studentId, {
    minImportance: 0.7,
    limit: 20
  });
  
  // 3. Task-relevant memories (semantic search if Vector DB available)
  const relevant = await getRelevantMemories(studentId, currentTask, limit: 10);
  
  // 4. Current tool usage
  const activeTools = await getActiveTools(studentId);
  
  // 5. Creativity profile
  const profile = await getCreativityProfile(studentId);
  
  return {
    recent,
    important: dedup(important, relevant),
    profile,
    activeTools,
    currentTask
  };
}
```

### 4.4 Importance scoring

Memories are scored on creation and decay over time:

```typescript
function scoreMemory(memory: Memory, context: ScoringContext): number {
  let score = 0.5; // baseline
  
  // Boost for first-time discoveries
  if (context.isFirstMention) score += 0.3;
  
  // Boost for emotional moments (detected via sentiment/keywords)
  if (context.emotionalIntensity > 0.7) score += 0.2;
  
  // Boost for creative works (linked to Work artifacts)
  if (context.linkedWorkId) score += 0.2;
  
  // Decay over time (unless accessed)
  const daysSinceCreated = (now() - memory.createdAt) / DAY_MS;
  const daysSinceAccessed = (now() - memory.lastAccessedAt) / DAY_MS;
  score *= Math.exp(-daysSinceAccessed / 30); // 30-day half-life
  
  return clamp(score, 0, 1);
}
```

Memories below threshold (e.g. 0.1) are archived or deleted per retention policy.

---

## 5. Tool-Calling Framework

### 5.1 Design principles

From product vision:
- Children **discover tools** through scenarios, not a menu
- Tools are **agents/models/workflows** children call to create IPs
- Children learn to **solve problems**: gather info, download skills, create tools, define workflows

### 5.2 Tool discovery flow

```
Child encounters a scenario in a lesson
    ↓
Agent suggests: "你可以用【画画助手】来试试"
    ↓
Child calls tool (tap icon or voice command)
    ↓
Tool added to child's workspace.tools
    ↓ next time
Tool appears in child's "工具箱" automatically
```

**Key insight**: Tools are not unlocked by admin; they're **discovered organically** through agent suggestions based on child's current task and phase.

### 5.3 Tool execution flow

```typescript
// Child calls a tool
const toolCall = {
  studentId: "student-123",
  toolId: "image-generator",
  input: {
    prompt: "一只在太空里的小猫",
    style: "cartoon"
  },
  context: {
    lessonId: "lesson-003",
    scenario: "创作自己的太空故事"
  }
};

// Agent service validates and dispatches
const result = await agentService.executeTool(toolCall);

// Tool calls through AI Gateway
const output = await aiGateway.imageTool({
  studentId: toolCall.studentId,
  toolId: toolCall.toolId,
  input: toolCall.input,
  context: toolCall.context
});

// Result becomes a Work in workspace
const work = await workspaceService.createWork({
  studentId: toolCall.studentId,
  type: "image",
  contentUrl: output.imageUrl,
  metadata: {
    toolUsed: toolCall.toolId,
    aiParams: { prompt: toolCall.input.prompt },
    degraded: output.meta.degraded
  }
});

// Tool usage recorded
await workspaceService.recordToolUsage({
  studentId: toolCall.studentId,
  toolId: toolCall.toolId,
  outcome: { success: true, workCreated: work.id }
});
```

### 5.4 Example tools for MVP+1

| Tool ID | Name | Category | What it does |
|---------|------|----------|-------------|
| `image-gen-basic` | 画画助手 | image | Generate images from text/doodle |
| `voice-composer` | 声音魔法 | voice | Create custom character voices |
| `story-weaver` | 故事编织机 | story | Co-create stories with AI |
| `3d-sculptor` | 立体创造 | 3d | Generate simple 3D models |
| `memory-finder` | 记忆宝盒 | workflow | Search child's past works/memories |
| `skill-library` | 技能图书馆 | skill | Download pre-made workflows |

**Expansion**: In later phases, children can **combine tools** into workflows, e.g. "先用画画助手创作角色，再用声音魔法给它配音，最后用故事编织机编一个冒险故事。"

---

## 6. Parent Co-Working

### 6.1 Design goals

From new requirements:
- Parents can **view** child's workspace at home (read-only post-class report → MVP)
- Parents can **co-work** with child and AI agent (new capability)
- Parent interactions become part of child's context but are tagged differently

### 6.2 Access model

```typescript
interface ParentAccess {
  parentId: string;
  studentId: string;
  permissions: {
    viewWorks: boolean;              // see child's portfolio
    viewInteractions: boolean;       // see interaction history (privacy-filtered)
    initiateInteractions: boolean;   // parent can talk to child's AI agent
    coCreateWorks: boolean;          // parent + child create together
  };
  
  // Governed by GuardianConsent
  granted: boolean;
  grantedAt: string;
}
```

**Privacy boundaries:**
- Parents see **child's works and summaries**, not raw interaction transcripts
- Raw audio is never stored or shown (ASR transcript only)
- Interaction history shows: timestamp, stage, output summary, works created
- Sensitive memories (if any) can be marked private to child

### 6.3 Co-working interaction flow

```
Parent opens child's workspace (WeChat miniapp or H5)
    ↓
Views child's recent works and agent suggestions
    ↓
Parent initiates: "我们一起给你的好朋友编个新故事吧"
    ↓
Interaction recorded with initiatedBy: "parent"
    ↓
Agent builds context: child's memories + parent co-work mode
    ↓
AI responds in co-work mode (warmer, includes parent)
    ↓
Output becomes a Work tagged as "parent_co_created"
    ↓
Next classroom session, agent remembers: "上次你和爸爸/妈妈一起..."
```

**Key insight**: Parent co-working is a **new interaction type**, not a separate product surface. Same workspace API, same agent, tagged differently.

### 6.4 WeChat miniapp integration

```
Parent receives WeChat template message after class
    ↓
"您的孩子完成了今天的课程，点击查看 →"
    ↓
Opens miniapp → authenticates via WeChat OAuth
    ↓
Miniapp calls: GET /students/:id/workspace (scoped by parentId)
    ↓
Shows: recent works, birth certificate, progress, co-work CTA
    ↓
Parent taps "和孩子一起创作" → initiates interaction
    ↓
Miniapp calls: POST /students/:id/interactions (initiatedBy: "parent")
    ↓
AI Gateway processes with parent co-work prompt variant
    ↓
Result displayed in miniapp, stored in workspace
```

**MVP path**: Start with H5 read-only artifact (planned parent feature), then add miniapp wrapper, then enable parent-initiated interactions.

---

## 7. Rich Media Pipeline

### 7.1 Media types and capabilities

| Media Type | MVP | Future | Physical Output |
|------------|-----|--------|-----------------|
| **Images** | ✓ Avatar, drawings | Animated images, style transfer | Printed stickers, cards |
| **Audio** | ✓ TTS voice, child voice (ASR only) | Custom voice cloning, music | QR code → audio playback |
| **Video** | - | Animated stories, stop-motion | - |
| **3D Models** | - | Simple sculptures, characters | 3D printed figurines |
| **Text** | ✓ Stories, poems | Interactive stories | Printed books |

### 7.2 Media storage architecture

```
Child creates work via tool
    ↓
Content Service: POST /upload → presigned URL
    ↓
Client uploads directly to Object Storage (Tencent COS)
    ↓
Content Service: POST /process (if media needs processing)
    ↓
Background worker: resize/transcode/moderate
    ↓
CDN URL ready
    ↓
Workspace Service: creates Work with contentUrl
    ↓
Child/parent views work via CDN
```

**Key decisions:**
- **Direct upload to object storage** — server doesn't proxy media, reduces latency
- **Async processing** — client polls for job completion, classroom never blocks
- **CDN delivery** — all media served via CDN, not application servers
- **Tenant-isolated buckets** — multi-city data residency

### 7.3 Physical souvenir workflow

```
Parent orders physical souvenir (e.g. 3D printed character)
    ↓
Workspace Service: GET /works/:id → validates media is 3D-printable
    ↓
Order Service (future): creates order, sends to fulfillment partner
    ↓
Fulfillment partner: downloads 3D model from presigned URL
    ↓
Physical item shipped to parent
    ↓
Order status updated in workspace
```

**MVP deferral**: Physical souvenirs are M7+; architecture should support it (3D model storage + CDN), but order/fulfillment service is future.

---

## 8. Multi-City Deployment

### 8.1 Tenant model

Every entity (student, classroom, workspace) belongs to a **tenant**:

```typescript
interface Tenant {
  id: string;
  name: string;                  // "Beijing Haidian Campus", "Shanghai Pudong"
  type: "city" | "school" | "partner";
  region: "cn-north" | "cn-east" | "cn-south"; // data residency
  
  config: {
    databaseUrl: string;         // tenant-specific DB or shared with isolation
    objectStorageBucket: string; // tenant-isolated bucket
    aiProviderConfig: string;    // tenant-specific AI routing (if needed)
  };
  
  capacity: {
    maxStudents: number;
    maxConcurrentSessions: number;
  };
  
  status: "active" | "suspended" | "archived";
  createdAt: string;
}
```

### 8.2 Deployment topology

**Option A: Shared infrastructure, tenant-isolated data**

```
┌─────────────────────────────────────────────────────────────┐
│  Single Kubernetes cluster (per region)                      │
│                                                               │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐ │
│  │  Service Pods  │  │  Service Pods  │  │  Service Pods  │ │
│  │  (replicated)  │  │  (replicated)  │  │  (replicated)  │ │
│  └────────────────┘  └────────────────┘  └────────────────┘ │
│                                                               │
│  All services handle all tenants (tenant-aware queries)      │
└─────────────────────────────────────────────────────────────┘
         ↓                      ↓                      ↓
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Shared         │  │  Shared         │  │  Tenant-isolated │
│  PostgreSQL     │  │  Redis Cluster  │  │  COS Buckets     │
│  (row-level     │  │                 │  │                  │
│   tenant filter)│  │                 │  │                  │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

**Pros:**
- Simpler ops, one deployment
- Efficient resource utilization
- Easy cross-tenant analytics (admin)

**Cons:**
- Noisy neighbor risk
- Tenant isolation bugs could leak data
- One cluster failure affects all cities

**Option B: Dedicated infrastructure per tenant**

```
┌──────────────────────┐  ┌──────────────────────┐
│  Beijing Cluster     │  │  Shanghai Cluster    │
│  ┌────────────────┐  │  │  ┌────────────────┐  │
│  │  Service Pods  │  │  │  │  Service Pods  │  │
│  └────────────────┘  │  │  └────────────────┘  │
│  Dedicated DB/Redis  │  │  Dedicated DB/Redis  │
└──────────────────────┘  └──────────────────────┘
```

**Pros:**
- Strong tenant isolation
- Regional data residency guaranteed
- Blast radius contained

**Cons:**
- Higher ops overhead
- Less efficient resource usage
- Cross-tenant analytics harder

**Recommendation**: **Start with Option A** (shared infrastructure, tenant-isolated data). Scale to Option B only if:
- Regulatory requirements demand physical isolation
- Single-cluster scale limits hit (unlikely for 20-30 students/class * dozens of cities)
- Tenant wants dedicated SLA/resources

### 8.3 Capacity planning for 20-30 students (premium service model)

**Single classroom session (premium model):**
- **20-30 students** (premium service, not 60)
- **4-6 assistants** (1 assistant per 5 students for personalized guidance)
- Each student: ~10 interactions/student × 30 tokens/interaction = ~9k tokens total
- Each student: ~3 images/student = 60-90 image generations total
- 20-30 concurrent student WebSocket connections
- 4-6 concurrent assistant WebSocket connections

**Infrastructure needs:**
- **Redis**: 20-30 students × 50KB state = 1-1.5MB per session (trivial)
- **PostgreSQL**: 20-30 students × 100 interactions × 1KB = 2-3MB per class (archived)
- **Object Storage**: 20-30 students × 5 works × 2MB/work = 200-300MB per class
- **Compute**: 2-4 CPU cores, 4-8GB RAM for classroom service (rule of thumb)

**Scale-out trigger**: When **concurrent classrooms** > 20, add horizontal replicas. Redis + PostgreSQL can handle 100+ concurrent classrooms before clustering needed.

**Premium service rationale**: The 1:5 assistant-to-student ratio enables:
- Personalized attention for each child
- Real-time intervention when child is stuck
- Richer observation for agent learning (assistant notes)
- Higher quality interaction data
- Better parent reports with specific observations

### 8.4 Distributed session management

Current MVP: in-process `KeyedMutex` for session atomicity (single-instance correct).

For multi-instance scale:

```typescript
// Replace in-process mutex with Redis-based distributed lock
class RedisSessionStore implements SessionStore {
  async update<T>(
    sessionId: string,
    fn: (current: ClassSession | null) => Promise<UpdateResult<T>>
  ): Promise<T> {
    const lock = await this.redlock.acquire([`lock:session:${sessionId}`], 5000);
    try {
      const current = await this.load(sessionId);
      const { next, out } = await fn(current);
      if (next) {
        // Use Redis SET with version check (optimistic locking)
        const version = current?.version ?? 0;
        next.version = version + 1;
        const ok = await this.redis.set(
          `session:${sessionId}`,
          JSON.stringify(next),
          'XX', // only if exists
          'GET' // return old value
        );
        if (!ok || JSON.parse(ok).version !== version) {
          throw new Error('session version conflict');
        }
      }
      return out;
    } finally {
      await lock.release();
    }
  }
}
```

**When to implement**: Before deploying multiple classroom service instances.

---

## 9. Service Boundaries and Contracts

### 9.1 Why service decomposition matters

As the product scales:
- **Classroom** is real-time, needs low latency → optimize for WebSocket, Redis hot state
- **Workspace** is persistent, needs complex queries → optimize for PostgreSQL, HTTP REST
- **Agent** is CPU-intensive, needs context building → can scale independently, cache heavily
- **Content** is I/O-bound, needs async processing → worker queues, separate scaling

Keeping them **in one monolith** initially is fine, but **logical boundaries** should be clear so we can extract services later without rewriting business logic.

### 9.2 Contract-first boundaries

Each service exposes a **typed contract** in `@genius-x/contracts`:

```typescript
// packages/contracts/src/workspace-api.ts
export interface WorkspaceAPI {
  getWorkspace(studentId: string): Promise<StudentWorkspace>;
  createWork(work: CreateWorkRequest): Promise<Work>;
  recordInteraction(interaction: RecordInteractionRequest): Promise<Interaction>;
  getMemories(studentId: string, filters: MemoryFilters): Promise<Memory[]>;
}

// packages/contracts/src/agent-api.ts
export interface AgentAPI {
  buildContext(studentId: string, task: string): Promise<AgentContext>;
  suggestTool(studentId: string, scenario: string): Promise<ToolSuggestion>;
  reflectInteraction(studentId: string, interactionId: string): Promise<void>;
}

// packages/contracts/src/content-api.ts
export interface ContentAPI {
  getUploadUrl(request: UploadRequest): Promise<PresignedUrl>;
  processMedia(jobId: string, spec: ProcessingSpec): Promise<Job>;
  getMediaUrl(mediaId: string): Promise<CDNUrl>;
}
```

These contracts are **implemented** initially as internal modules in `apps/server`, but can be **extracted** later to separate services without changing callers.

---

## 10. Migration Path from MVP

### 10.1 Current state (MVP baseline)

```
apps/server:
  - Fastify HTTP (join, state API)
  - Socket.IO (classroom sync)
  - InMemorySessionStore / RedisSessionStore
  - ClassroomController (generic state machine)

apps/web:
  - React single app (student, assistant, teacher roles)
  - Query param role routing

packages/ai-gateway:
  - FakeProvider
  - Safety, fallback, trace seams

packages/contracts:
  - ClassSession, StudentRuntimeState
  - WebSocket messages
  - AI result types
```

**Key insight**: MVP is **classroom-centric**. Students are ephemeral. No persistent workspace, no agent memory, no parent co-work.

### 10.2 Phase 1: Add persistent identity

**Goal**: Students get permanent IDs via parent enrollment before class.

**Changes:**
1. Add `apps/server/src/identity` module (or extract to `apps/identity-service` later)
2. Add PostgreSQL schema: `students`, `parents`, `guardian_consent`, `tenants`
3. Add Identity Service API: `POST /parents`, `POST /students`
4. Update classroom join: lookup student by `studentId` (not create ephemeral)
5. Link `ClassSession.students` to persistent `Student.id`

**Migration**: Existing ephemeral students from MVP demos can be backfilled or discarded.

**Contracts**: Add `packages/contracts/src/identity.ts`

### 10.3 Phase 2: Add workspace service

**Goal**: Persist works, interactions, memories after each classroom stage.

**Changes:**
1. Add `apps/server/src/workspace` module
2. Add PostgreSQL schema: `works`, `interactions`, `memories`, `tool_usage`
3. Add Workspace Service API (REST)
4. Update classroom controller: after each stage, write artifacts → workspace
5. Add object storage integration (Tencent COS SDK)

**Migration**: Current `StudentRuntimeState` can be **archived** to workspace at class end initially, then move to real-time writes per stage.

**Contracts**: Add `packages/contracts/src/workspace-api.ts`

### 10.4 Phase 3: Add agent service

**Goal**: Agent builds context from workspace for personalized responses.

**Changes:**
1. Add `apps/server/src/agent` module
2. Add PostgreSQL schema: `student_agents`, `creativity_profiles`
3. Extend Redis: agent short-term memory
4. Add Agent Service API
5. Update AI Gateway: inject agent context into prompts

**Migration**: Existing students get default agent state; creativity profiles build over time.

**Contracts**: Add `packages/contracts/src/agent-api.ts`

### 10.5 Phase 4: Add tool registry and tool-calling

**Goal**: Children discover and call tools to create works.

**Changes:**
1. Add PostgreSQL schema: `tools`, `tool_usage`
2. Extend AI Gateway: tool dispatch endpoints
3. Add tool suggestion logic in agent service
4. Update student UI: tool discovery and "工具箱"

**Contracts**: Add `packages/contracts/src/tool.ts`

### 10.6 Phase 5: Add parent co-working

**Goal**: Parents can view workspace and initiate interactions.

**Changes:**
1. Add parent authentication (WeChat OAuth)
2. Add parent access control middleware
3. Extend Workspace API: parent-scoped endpoints
4. Add WeChat miniapp frontend (or H5 with WeChat auth)
5. Update agent prompts: parent co-work mode

**Contracts**: Extend `packages/contracts/src/workspace-api.ts` with parent access

### 10.7 Phase 6: Extract services (optional)

**When**: Only when scale demands it (100+ concurrent classrooms, separate team ownership).

**How**:
1. Move `apps/server/src/workspace` → `apps/workspace-service`
2. Move `apps/server/src/agent` → `apps/agent-service`
3. Replace in-process calls with HTTP/gRPC
4. Add API gateway for routing

**Contracts unchanged** — callers still import from `@genius-x/contracts` and use typed interfaces.

---

## 11. Technology Recommendations

### 11.1 Storage

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Hot session state** | Redis | Current choice correct; add Redis Cluster for multi-city |
| **Persistent data** | PostgreSQL | Relational queries, JSONB for flexible schemas, mature ecosystem |
| **Object storage** | Tencent COS | China deployment, CDN integration, presigned URLs |
| **Vector DB (optional)** | Pinecone / Weaviate / pgvector | Only if semantic memory search needed; pgvector simplest (PostgreSQL extension) |

### 11.2 Compute

| Service | Technology | Rationale |
|---------|------------|-----------|
| **Classroom** | Node.js + Fastify + Socket.IO | Current choice correct; real-time WebSocket strength |
| **Workspace** | Node.js + Fastify (or Python + FastAPI) | REST API, PostgreSQL ORM (Prisma/TypeORM for Node, SQLAlchemy for Python) |
| **Agent** | Python + FastAPI | Context building, embeddings, ML-friendly; or Node if team prefers |
| **Content** | Node.js + Bull queue | Async job processing, Redis-backed queue |

### 11.3 AI providers

| Capability | Primary | Fallback | Notes |
|------------|---------|----------|-------|
| **LLM** | Doubao (ByteDance) | Tencent Hunyuan | China-compliant, low latency |
| **TTS** | Tencent TTS | Microsoft Azure TTS | Child-friendly voices |
| **ASR** | Tencent ASR | Alibaba ASR | Child voice optimized |
| **Image Gen** | Tencent Hunyuan / Stable Diffusion (self-hosted) | DALL-E 3 (境外备选) | Quality vs cost tradeoff |
| **3D Gen (future)** | Meshy / Luma AI | - | Emerging, evaluate M7+ |

### 11.4 Deployment

| Aspect | Technology | Rationale |
|--------|------------|-----------|
| **Container orchestration** | Kubernetes (Tencent TKE) | Cloud-native, horizontal scaling, multi-city deployment |
| **CI/CD** | GitHub Actions → Tencent TKE | Existing repo on GitHub, TKE is Tencent's managed K8s |
| **Monitoring** | Prometheus + Grafana | Open-source, K8s-native |
| **Logging** | Tencent CLS (Cloud Log Service) | Centralized logs, China compliance |
| **Tracing (optional)** | Langfuse (shadow) | AI trace/debug, already in MVP seam |

---

## 12. Data Retention and Privacy

### 12.1 Retention policy

| Data Type | Retention | Rationale |
|-----------|-----------|-----------|
| **Raw audio** | Never stored | Privacy rule: ASR transcript only |
| **Classroom sessions (Redis)** | 1 hour after class ends | Grace period for reconnect, then archived |
| **Classroom sessions (PostgreSQL archive)** | 1 year | Analytics, model improvement |
| **Student workspaces** | Lifetime of account + 1 year after deletion | Child's creative portfolio |
| **Interactions** | Same as workspaces | Context for agent |
| **Memories** | Same as workspaces, or decay if importance < threshold | Agent long-term memory |
| **Works (object storage)** | Same as workspaces | Media assets |
| **Parent data** | Lifetime of linked students | Account management |
| **Operator logs (AI params, degraded status)** | 90 days | Debugging, compliance |

### 12.2 Privacy boundaries

| Boundary | Rule |
|----------|------|
| **Child-facing UI** | Never show: "Prompt", "LLM", "token", "AI", raw audio, operator metadata |
| **Parent-facing UI** | Show: works, summaries, progress. Never show: raw transcripts, sensitive memories (if marked) |
| **Operator-facing UI** | Show: degraded status, fallback counts, AI params, interaction metadata |
| **External APIs** | Never expose: student data, raw classroom state. Only: public artifacts (birth certificates, parent reports) with tokens |
| **Cross-tenant** | Never: one tenant cannot query another tenant's data (enforced at DB query level) |

### 12.3 Compliance (China context)

- **Data residency**: All child data stored in China (Tencent Cloud China regions)
- **Content moderation**: Tencent TMS (text) + IMS (image) before showing to child
- **Guardian consent**: Required before enrollment, versioned, auditable
- **Data export**: Parent can request child's full workspace export
- **Data deletion**: Parent can request child account deletion (soft delete + retention per regulation)

---

## 13. Phased Implementation Plan

### Phase 0: Architecture design (current)
- **Goal**: Freeze scalable architecture before building
- **Deliverable**: This document + team alignment

### Phase 1: Persistent identity and enrollment (2-3 weeks)
- **Build**:
  - PostgreSQL schema: students, parents, tenants
  - Identity Service API
  - Parent enrollment flow (H5 or admin tool)
  - Update classroom join to use persistent student IDs
- **Test**: Parent enrolls student → student joins classroom → session archives to persistent student
- **Contracts**: `identity.ts`, `enrollment.ts`

### Phase 2: Student workspace foundation (3-4 weeks)
- **Build**:
  - PostgreSQL schema: works, interactions, memories
  - Workspace Service API (CRUD)
  - Object storage integration (Tencent COS)
  - Update classroom controller: write artifacts to workspace after each stage
- **Test**: Classroom session → works stored in workspace → parent can view via API
- **Contracts**: `workspace-api.ts`

### Phase 3: Parent read-only artifact (2 weeks)
- **Build** (original parent MVP plan):
  - Parent share artifact generation
  - Parent H5/miniapp read-only view
  - WeChat template message notification
- **Test**: Parent receives notification → opens H5 → sees child's works + birth certificate
- **Contracts**: `parent-share.ts`

### Phase 4: Agent service with memory (4-5 weeks)
- **Build**:
  - PostgreSQL schema: student_agents, creativity_profiles
  - Redis: agent short-term memory
  - Agent Service API: context builder, memory retrieval
  - Update AI Gateway: inject agent context into prompts
  - Memory importance scoring and decay
- **Test**: Child interacts → memories extracted → next interaction uses relevant context
- **Contracts**: `agent-api.ts`, `agent-context.ts`

### Phase 5: Tool registry and tool-calling (3-4 weeks)
- **Build**:
  - PostgreSQL schema: tools, tool_usage
  - Tool registry seeding (5-10 initial tools)
  - AI Gateway: tool dispatch endpoints
  - Agent service: tool suggestion logic
  - Student UI: tool discovery + "工具箱"
- **Test**: Child encounters scenario → agent suggests tool → child calls tool → work created
- **Contracts**: `tool.ts`, `tool-api.ts`

### Phase 6: Parent co-working (3 weeks)
- **Build**:
  - WeChat OAuth integration
  - Parent-scoped Workspace API endpoints
  - Agent: parent co-work prompt variants
  - Miniapp: parent-initiated interaction UI
- **Test**: Parent initiates interaction → agent responds in co-work mode → work tagged parent_co_created
- **Contracts**: Extend `workspace-api.ts`

### Phase 7: Rich media pipeline (4-5 weeks)
- **Build**:
  - Content Service API
  - Async media processing workers (resize, transcode, moderate)
  - Video generation integration (if provider ready)
  - 3D model generation integration (if provider ready)
- **Test**: Child creates video/3D work → async processing → CDN URL ready → viewable in workspace
- **Contracts**: `content-api.ts`, `media-processing.ts`

### Phase 8: Multi-city deployment (2-3 weeks)
- **Build**:
  - Tenant management UI
  - Tenant-aware queries (row-level security or app-level filtering)
  - Deploy to multiple Tencent Cloud regions
  - Distributed session management (Redis locks)
- **Test**: Two classrooms in different cities running concurrently, data isolated
- **Contracts**: `tenant.ts`

**Total estimated timeline**: ~6-7 months for full architecture (Phases 1-8).

**MVP-to-scale path**: Phases 1-3 (identity + workspace + parent) are the critical path to make parent feature scalable. Phases 4-8 are incremental expansions.

---

## 14. Open Questions and Decisions Needed

### 14.1 Product decisions

1. **Tool discovery UX**: Should tools appear as icons in a persistent "工具箱", or only as agent suggestions in-context?
2. **Parent co-work scope**: Can parents initiate interactions when child is not present, or only supervised co-work?
3. **Memory privacy**: Should children be able to mark memories as "private" (hidden from parents)?
4. **Physical souvenirs**: Which works are 3D-printable? What's the fulfillment partner model?
5. **Tool combination**: Phase 1 of tool-calling is single-tool use. When do children combine tools into workflows?

### 14.2 Technical decisions

1. **Service decomposition timing**: Start with modular monolith (all services in `apps/server`) or extract workspace/agent services immediately?
2. **Vector DB**: Use pgvector (PostgreSQL extension) for simplicity, or dedicated vector DB (Pinecone/Weaviate) for scale?
3. **Agent context caching**: Cache built contexts in Redis, or rebuild on every interaction?
4. **Tool execution isolation**: Run tool calls in-process, or separate worker pool?
5. **WeChat miniapp vs H5**: Build native miniapp or H5 with WeChat auth wrapper?

### 14.3 Capacity and cost

1. **Concurrent classroom target**: 10? 50? 100? Drives horizontal scaling timeline.
2. **AI cost per student**: Current Lesson 1 estimate ~$0.50/student. With agent memory and tool-calling, what's the new budget?
3. **Storage growth**: 30 students × 100 interactions × 5 works × 2MB = ~30GB per class (premium model). Retention policy affects cost significantly.

---

## 15. Success Metrics

### 15.1 Technical metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Classroom uptime** | 99.9% during class hours | Prometheus |
| **WebSocket latency** | p95 < 500ms | Socket.IO metrics |
| **API latency (workspace)** | p95 < 200ms | Fastify metrics |
| **AI Gateway latency** | p95 < 8s (LLM), < 15s (image) | Gateway trace |
| **Fallback rate** | < 5% of AI calls | Gateway trace |
| **Memory extraction success** | > 80% of interactions | Agent service metrics |
| **Concurrent classrooms supported** | 20-30 students/class × dozens of cities | Load testing |

### 15.2 Product metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Student retention** | > 80% complete Lesson 2 after Lesson 1 | PostgreSQL query |
| **Parent engagement** | > 60% open post-class notification | WeChat template message stats |
| **Parent co-work rate** | > 30% of parents initiate ≥1 interaction | Workspace API logs |
| **Tool usage diversity** | Average student uses ≥3 different tools by Phase 2 | Tool usage logs |
| **Work creation rate** | Average ≥10 works per student per phase | Workspace query |

---

## 16. Next Steps

1. **Review this document** with product and eng leads
2. **Finalize open decisions** (§14)
3. **Freeze Phase 1 contracts** (`identity.ts`, `enrollment.ts`)
4. **Kick off Phase 1 implementation**: Persistent identity and enrollment
5. **Update AGENTS.md** with new service ownership map
6. **Create design notes** for Phase 1 modules per `docs/agents/README.md` protocol

---

_Genius X · Scalable Architecture v2.0_
_Author: Claude (Opus 4.8) + Product Lead_
_Date: 2026-06-08_
_Status: Design phase — ready for team review_
