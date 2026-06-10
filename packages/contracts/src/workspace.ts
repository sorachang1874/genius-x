/**
 * Student workspace domain types — contracts v1 (Phase 2).
 *
 * Typed realization of `docs/contracts/workspace.md` (the frozen prose contract). The
 * workspace is the child's PERSISTENT creative portfolio: works, interaction history, and
 * extracted memories — written by the Classroom Service per stage (fire-and-forget, never
 * blocking the lesson), read by operators now and by the Phase-3 parent artifact later.
 *
 * Naming vs existing exports (barrel-safe): the persistent memory is `StudentMemory`
 * (the runtime `Memory` in student.ts is the in-class ephemeral one); interactions are
 * `InteractionRecord`. `Work.type` is the opaque, lesson-declared `ArtifactType`
 * (enums.ts philosophy: new lessons add artifact types without contract migrations) —
 * a deliberate divergence from the architecture sketch's closed enum (§2.2).
 *
 * Privacy (frozen, from data-and-privacy.md + architecture §6.2): interaction inputs
 * carry REFS, never raw bytes (no raw audio anywhere); parent-facing reads (Phase 3) see
 * works + summaries, never raw transcripts; `degraded` stays operator-visible end-to-end.
 *
 * Pure TypeScript types only — zod/wire validation lives at the service boundary.
 */
import type { ArtifactType, MemoryKey, StageId } from "./enums";

// --- Work (a creative output the child produced) ---

/**
 * Provenance + operator metadata for a work. `aiParams`/`degraded` are OPERATOR-facing
 * (model output is a contract: prompt versions etc. recorded for review/rollback) and are
 * NEVER rendered to a child; parent views (Phase 3) omit them too.
 */
export interface WorkMetadata {
  lessonId: string;
  stageId: StageId;
  /** Classroom session that produced it; absent for after-class creations (Phase 6). */
  sessionId?: string;
  /** Prompt version / model id etc. — operator-visible audit, never child/parent-facing. */
  aiParams?: Record<string, unknown>;
  /** Was any contributing AI call degraded? Operator-visible (degradation principle). */
  degraded: boolean;
}

export interface Work {
  id: string; // UUID
  studentId: string;
  tenantId: string; // isolation boundary (denormalized; enforced by composite FK)
  /** Opaque, lesson-declared (`declaredArtifactTypes`), e.g. "birth_certificate". */
  type: ArtifactType;
  /** Media reference (COS/CDN URL once real storage lands — M6/Phase 7; ref, never bytes). */
  contentUrl?: string;
  /** Text works (stories, poems). */
  contentText?: string;
  /** Structured works (e.g. the birth certificate) — render-ready JSON. */
  contentJson?: Record<string, unknown>;
  thumbnailUrl?: string;
  metadata: WorkMetadata;
  createdAt: string; // ISO
}

// --- InteractionRecord (one child↔companion exchange, persisted) ---

/**
 * Input as PERSISTED: kind mirrors the wire `InteractionInput.kind` (lesson-extensible;
 * Lesson-1 wire kinds: "voice" | "doodle" | "answers" | "talentOption" | "talentAnswer").
 * Content is a REF or short text only — raw audio/doodle bytes are never stored (privacy
 * contract). STRUCTURED wire inputs (e.g. `answersByQuestionId`) persist their payload as
 * canonical JSON in `text` — there is deliberately no open metadata escape hatch.
 */
export interface InteractionInputRecord {
  kind: string; // opaque, wire-mirrored (see above)
  contentRef?: string; // e.g. audioRef/doodleRef — reference, never bytes
  text?: string; // ASR transcript, typed text, or canonical-JSON payload of structured inputs
}

export interface InteractionOutputRecord {
  kind: string; // "text" | "audio" | "images" | ... (opaque)
  contentRef?: string;
  text?: string;
  /** Set when this exchange produced a Work (e.g. the chosen avatar). */
  workId?: string;
  /** Operator-visible: was this reply a fallback? (degradation principle) */
  degraded: boolean;
}

export interface InteractionContext {
  lessonId: string;
  stageId: StageId;
  sessionId?: string; // absent for after-class interactions (Phase 6)
  /** Parent co-working (Phase 6) tags its interactions; classroom = "student". */
  initiatedBy: "student" | "parent";
}

export interface InteractionRecord {
  id: string; // UUID
  studentId: string;
  tenantId: string;
  occurredAt: string; // ISO
  context: InteractionContext;
  input: InteractionInputRecord;
  output: InteractionOutputRecord;
  /** StudentMemory ids extracted from this exchange (filled async; often empty). */
  memoriesExtracted: string[];
  createdAt: string; // ISO
}

// --- StudentMemory (persistent, importance-scored memory) ---

export interface MemoryContext {
  lessonId: string;
  stageId: StageId;
  sessionId?: string;
  /** The interaction this memory was mined from, when known. */
  sourceInteractionId?: string;
}

/**
 * Persistent memory (the runtime `Memory` in student.ts is its ephemeral in-class twin).
 * Phase 2 stores with BASELINE importance (0.5); real scoring/decay + embeddings are the
 * Phase-4 agent's job (semantic search = DF-v2-9). Access-tracking fields exist now so
 * Phase 4 needs no migration FOR THEM (an embedding column/pgvector will still be a
 * Phase-4 migration).
 */
export interface StudentMemory {
  id: string; // UUID
  studentId: string;
  tenantId: string;
  key: MemoryKey; // opaque, lesson-declared (declaredMemoryKeys)
  value: string;
  context: MemoryContext;
  importance: number; // 0..1; Phase 2 default 0.5
  lastAccessedAt: string; // ISO
  accessCount: number;
  createdAt: string; // ISO
}

// --- Server-internal write shapes (Classroom Service → WorkspaceService; NOT exposed over HTTP in Phase 2) ---

/** Create a work. `tenantId` derives from the student (never caller-supplied). */
export interface RecordWorkRequest {
  studentId: string;
  type: ArtifactType;
  contentUrl?: string;
  contentText?: string;
  contentJson?: Record<string, unknown>;
  thumbnailUrl?: string;
  metadata: WorkMetadata;
}

export interface RecordInteractionRequest {
  studentId: string;
  occurredAt: string; // ISO — the classroom's clock (not the DB's)
  context: InteractionContext;
  input: InteractionInputRecord;
  output: InteractionOutputRecord;
}

export interface RecordMemoryRequest {
  studentId: string;
  key: MemoryKey;
  value: string;
  context: MemoryContext;
  /** Defaults to 0.5 (baseline) — real scoring is Phase 4. */
  importance?: number;
}
