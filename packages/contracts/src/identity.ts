/**
 * Identity & enrollment domain types — contracts v1 (Phase 1).
 *
 * Typed realization of `docs/contracts/identity.md` (the frozen prose contract; owner
 * matrices, allowed values, deletion conditions, and preflight live there).
 *
 * These are PERSISTENT records (PostgreSQL), distinct from the ephemeral classroom runtime:
 *   - `Student`             → permanent identity, created by parent enrollment before class.
 *   - `StudentRuntimeState` (student.ts) → per-class Redis runtime; created/initialized on
 *                             join, pre-filled from `Student.displayName`, discarded after class.
 *   - `StudentProfile`      (student.ts) → legacy PRD aggregate, now @deprecated in favor of
 *                             `Student` + the Phase 2 workspace.
 *
 * Pure TypeScript types only — NO zod here (matches the rest of @genius-x/contracts).
 * Runtime validation (zod schemas, age bounds, tenant FK) lives in the Identity Service
 * boundary (`apps/server/src/identity`), per the enrollment contract.
 */

// --- Tenant (organizational unit for multi-city / multi-school isolation) ---

/** City / school / partner org. Every persistent entity belongs to exactly one tenant. */
export type TenantType = "city" | "school" | "partner";

export type TenantStatus = "active" | "suspended" | "archived";

/**
 * Data-residency region. Open string (forward-compat with new regions), consistent with the
 * opaque-id philosophy in enums.ts. Known Phase 1 values: "cn-north", "cn-east", "cn-south".
 */
export type Region = string;

/** Tenant-scoped infrastructure overrides. All optional; absent ⇒ shared default infra. */
export interface TenantConfig {
  databaseUrl?: string; // tenant-specific DB (Phase 8); absent ⇒ shared DB w/ row filter
  objectStorageBucket?: string; // tenant-isolated media bucket (Phase 2/7)
  aiProviderConfig?: string; // tenant-specific AI routing (Phase 8)
}

/**
 * Capacity limits for a tenant. Per-classroom sizing (students/assistants per live session)
 * is a CLASSROOM concern, not a tenant one — see {@link PREMIUM_CLASSROOM}.
 */
export interface TenantCapacity {
  /**
   * Total ENROLLED students allowed in this tenant (e.g. up to ~10k). Do NOT confuse with
   * {@link PREMIUM_CLASSROOM}.maxStudents (30), which is the per-live-classroom cap. This is a
   * tenant-wide enrollment ceiling; that is a single-session sizing limit.
   */
  maxStudents: number;
  maxConcurrentSessions: number; // live classrooms this tenant may run at once
}

export interface Tenant {
  id: string; // UUID
  name: string; // e.g. "Beijing Haidian Campus"
  type: TenantType;
  region: Region;
  config: TenantConfig;
  capacity: TenantCapacity;
  status: TenantStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

// --- Parent (guardian account; may link to multiple students) ---

export interface Parent {
  id: string; // UUID
  tenantId: string; // owning tenant (isolation boundary)
  wechatOpenId?: string; // for WeChat miniapp (Phase 6+); optional in Phase 1
  phoneNumber?: string; // for SMS notifications; optional in Phase 1
  createdAt: string; // ISO
}

// --- Guardian consent (versioned; exactly one current record per student) ---

/**
 * Versioned guardian consent. Exactly ONE row per student (DB UNIQUE on studentId): updating
 * consent overwrites that row to the new `consentVersion` — the prior version is NOT retained
 * (a consent-history audit log is a future extension). `consentVersion` tracks the
 * consent-policy version the guardian agreed to.
 *
 * The storage surrogate PK and `created_at` (see the guardian_consents SQL) are intentionally
 * NOT surfaced here: `studentId` is the unique API key, so the wire body needs no surrogate id.
 */
export interface GuardianConsent {
  studentId: string;
  parentId: string;
  consentGivenAt: string; // ISO
  consentVersion: string; // semantic version of the consent policy (e.g. "v1.0")
  dataRetentionAgreed: boolean; // required true to enroll
  parentCoWorkAllowed: boolean; // gates parent-initiated interactions (Phase 6)
  mediaUsageAllowed: boolean; // gates showcase/promotion use of the child's works
  /** Gates PHYSICAL-carrier use of the child's works & IP character (cards/cups/stickers/
   *  growth books — decision ④'s 实体 path). A DISTINCT purpose from digital showcase
   *  (PIPL: new purpose ⇒ separate consent), collected NOW so the merch path never needs
   *  a re-authorization campaign. Founder framing (2026-06-10): the goal is INCENTIVE
   *  (「让我的作品被看到」), not commercialization. */
  ipPhysicalUseAllowed: boolean;
}

// --- Student (permanent child profile) ---

/**
 * Genius X companion state — populated DURING/AFTER Lesson 1, blank at enrollment.
 *
 * Distinct from the runtime `GeniusX` (student.ts), which also carries a live `memories`
 * array; persistent memories belong to the Phase 2 workspace, not here. Written by the
 * Classroom Service after stages complete (server-internal), never by the parent API.
 */
export interface GeniusXProfile {
  name?: string; // confirmed in Lesson 2
  avatarUrl?: string; // from Lesson 1 Shape stage
  personalityTag?: string; // extracted during interactions
  backgroundSetting?: string; // from Lesson 1 Shape stage
  birthdaySpeech?: string; // from Lesson 1 Birth stage
}

/**
 * Lesson-level progress. Distinct from the runtime `Progress` (student.ts), which tracks
 * stage-level state within a single class. Written by the Classroom Service, never the
 * parent API. `currentPhase` is the Manifesto growth arc (1–4).
 */
export interface StudentProgress {
  completedLessonIds: string[]; // e.g. ["lesson-001"]
  currentPhase: number; // 1–4 (Manifesto growth arc); enforced in service + DB CHECK
  badges: string[];
}

/**
 * Persistent child profile. Created via parent enrollment before the first class; the `id`
 * survives across every lesson. Looked up (not created) on classroom join.
 */
export interface Student {
  id: string; // UUID — permanent across all lessons
  tenantId: string; // immutable isolation boundary
  parentId: string; // owning parent
  displayName: string; // child's name for UI / birth certificate; non-empty
  age: number; // 4–10 per product rules; enforced in service + DB CHECK
  enrolledAt: string; // ISO
  geniusX: GeniusXProfile; // companion state (blank until Lesson 1 populates it)
  progress: StudentProgress; // lesson progress (defaults to phase 1, empty)
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

// --- Premium service model (Phase 1 correction) ---

/**
 * Premium classroom sizing — the corrected Phase 1 capacity model (NOT the legacy "60").
 * High-touch service: a 1:5 assistant-to-student ratio for personalized guidance.
 *
 * This is the single source of truth for the numbers so the stale "60 students" cannot creep
 * back into seeds/docs. Per-classroom ENFORCEMENT is a Classroom-Service concern (Phase 5+);
 * Phase 1 only records the model. Tenant-level limits are separate ({@link TenantCapacity}).
 */
export const PREMIUM_CLASSROOM = {
  minStudents: 20,
  maxStudents: 30,
  /** 1 assistant per N students. */
  studentsPerAssistant: 5,
  minAssistants: 4,
  maxAssistants: 6,
} as const;
