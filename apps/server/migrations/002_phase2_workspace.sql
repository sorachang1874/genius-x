-- 002_phase2_workspace.sql — Phase 2: student workspace (works, interactions, memories).
--
-- Typed contract:  packages/contracts/src/workspace.ts (+ workspace-api.ts)  (frozen v1)
-- Prose contract:  docs/contracts/workspace.md (frozen v1)
--
-- Conventions (as 001): snake_case ↔ camelCase; created_at is DB-clock, occurred_at is the
-- CLASSROOM clock; tenant isolation AT THE DATA LAYER via composite FKs to
-- students(id, tenant_id) — a workspace row can never point across tenants.
-- NO BEGIN/COMMIT here: the migrate runner owns the transaction (scripts/migrate.ts).
--
-- Size bounds (workspace.md → Validation): refs ≤ 512 (references, never bytes — privacy),
-- text ≤ 64KB, memory value ≤ 4KB. Retention/deletion is policy-driven (Phase 8): plain FKs,
-- no CASCADE — workspace rows outlive sessions and are deleted only by the retention job.

-- FK target for the composite isolation FKs below (001 exposed (id, parent_id) only).
ALTER TABLE students ADD CONSTRAINT students_id_tenant_unique UNIQUE (id, tenant_id);

-- --- works — the child's creative outputs -----------------------------------------

CREATE TABLE works (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id    UUID        NOT NULL,
  tenant_id     UUID        NOT NULL,
  -- Opaque, lesson-declared artifact type (∈ declaredArtifactTypes; service validates
  -- against the lesson config — the DB cannot see lesson configs).
  type          TEXT        NOT NULL CHECK (btrim(type) <> '' AND length(type) <= 200),
  content_url   TEXT        CHECK (content_url <> '' AND length(content_url) <= 2048),
  content_text  TEXT        CHECK (content_text <> '' AND length(content_text) <= 65536),
  -- Bounded: a JSONB blob could otherwise smuggle raw bytes past refs-never-bytes (≤64KB).
  content_json  JSONB       CHECK (jsonb_typeof(content_json) = 'object' AND pg_column_size(content_json) <= 65536),
  thumbnail_url TEXT        CHECK (thumbnail_url <> '' AND length(thumbnail_url) <= 2048),

  -- WorkMetadata (provenance; ai_params/degraded are OPERATOR-facing, never child/parent UI)
  lesson_id     TEXT        NOT NULL CHECK (btrim(lesson_id) <> '' AND length(lesson_id) <= 200),
  stage_id      TEXT        NOT NULL CHECK (btrim(stage_id) <> '' AND length(stage_id) <= 200),
  session_id    TEXT        CHECK (session_id <> '' AND length(session_id) <= 128),
  -- Operator audit, bounded (≤16KB) — never a full prompt/response dump.
  ai_params     JSONB       CHECK (ai_params IS NULL OR (jsonb_typeof(ai_params) = 'object' AND pg_column_size(ai_params) <= 16384)),
  degraded      BOOLEAN     NOT NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- No empty works: at least one content field is present (a NULL CHECK passes, hence OR).
  CONSTRAINT works_not_empty CHECK (content_url IS NOT NULL OR content_text IS NOT NULL OR content_json IS NOT NULL),
  -- Data-layer tenant isolation (same pattern as 001 students→parents).
  CONSTRAINT works_student_same_tenant FOREIGN KEY (student_id, tenant_id) REFERENCES students(id, tenant_id),
  -- FK target so cross-row POINTERS are student-scoped too (see interactions below).
  CONSTRAINT works_id_student_unique UNIQUE (id, student_id)
);

-- --- interactions — one child↔companion exchange, persisted -----------------------

CREATE TABLE interactions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      UUID        NOT NULL,
  tenant_id       UUID        NOT NULL,
  -- Classroom clock (contract: occurredAt); sanity-bounded against the DB clock so a
  -- skewed/buggy writer cannot poison recency reads or retention math.
  occurred_at     TIMESTAMPTZ NOT NULL CHECK (occurred_at >= TIMESTAMPTZ '2024-01-01' AND occurred_at <= created_at + INTERVAL '1 day'),

  -- InteractionContext
  lesson_id       TEXT        NOT NULL CHECK (btrim(lesson_id) <> '' AND length(lesson_id) <= 200),
  stage_id        TEXT        NOT NULL CHECK (btrim(stage_id) <> '' AND length(stage_id) <= 200),
  session_id      TEXT        CHECK (session_id <> '' AND length(session_id) <= 128),
  -- NO DEFAULT (001 consent precedent): the co-work tagging this field exists for must be
  -- supplied explicitly — omission fails loudly, never silently records 'student'.
  initiated_by    TEXT        NOT NULL CHECK (initiated_by IN ('student', 'parent')),

  -- Input: REF or short text only — raw audio/doodle bytes are NEVER stored (privacy).
  input_kind      TEXT        NOT NULL CHECK (btrim(input_kind) <> '' AND length(input_kind) <= 100),
  input_ref       TEXT        CHECK (input_ref <> '' AND length(input_ref) <= 512),
  input_text      TEXT        CHECK (input_text <> '' AND length(input_text) <= 65536),

  -- Output (+ operator-visible degraded flag; optional link to the Work it produced).
  output_kind     TEXT        NOT NULL CHECK (btrim(output_kind) <> '' AND length(output_kind) <= 100),
  output_ref      TEXT        CHECK (output_ref <> '' AND length(output_ref) <= 512),
  output_text     TEXT        CHECK (output_text <> '' AND length(output_text) <= 65536),
  output_work_id  UUID,
  output_degraded BOOLEAN     NOT NULL,

  -- StudentMemory ids mined from this exchange (filled async by recordMemory, SAME-student
  -- only). No NULL elements (001 precedent), bounded growth; array→memories integrity is
  -- the LATERAL preflight in workspace.md §Validation (realized in the PGlite suite).
  memories_extracted UUID[]   NOT NULL DEFAULT '{}'
    CHECK (array_position(memories_extracted, NULL) IS NULL AND cardinality(memories_extracted) <= 64),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT interactions_student_same_tenant FOREIGN KEY (student_id, tenant_id) REFERENCES students(id, tenant_id),
  -- Cross-row pointers are STUDENT-scoped (the isolation claim is meaningless otherwise):
  -- an interaction can only reference ITS OWN student's work. NULL pointer stays legal.
  CONSTRAINT interactions_work_same_student FOREIGN KEY (output_work_id, student_id) REFERENCES works(id, student_id),
  -- FK target for memories.source_interaction_id below.
  CONSTRAINT interactions_id_student_unique UNIQUE (id, student_id)
);

-- --- memories — persistent, importance-scored (scoring = Phase 4) -----------------

CREATE TABLE memories (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            UUID        NOT NULL,
  tenant_id             UUID        NOT NULL,
  key                   TEXT        NOT NULL CHECK (btrim(key) <> '' AND length(key) <= 200), -- ∈ declaredMemoryKeys (service-validated)
  value                 TEXT        NOT NULL CHECK (btrim(value) <> '' AND length(value) <= 4096),

  -- MemoryContext
  lesson_id             TEXT        NOT NULL CHECK (btrim(lesson_id) <> '' AND length(lesson_id) <= 200),
  stage_id              TEXT        NOT NULL CHECK (btrim(stage_id) <> '' AND length(stage_id) <= 200),
  session_id            TEXT        CHECK (session_id <> '' AND length(session_id) <= 128),
  source_interaction_id UUID,

  -- DOUBLE PRECISION: exact JS-number round-trip (REAL/float4 upcasts lossily and breaks
  -- keyset-cursor equality, e.g. 0.7 → 0.699999988079071).
  importance            DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  last_accessed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  access_count          INTEGER     NOT NULL DEFAULT 0 CHECK (access_count >= 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT memories_student_same_tenant FOREIGN KEY (student_id, tenant_id) REFERENCES students(id, tenant_id),
  -- A memory can only point at ITS OWN student's interaction (student-scoped pointer).
  CONSTRAINT memories_interaction_same_student FOREIGN KEY (source_interaction_id, student_id) REFERENCES interactions(id, student_id)
);

-- --- indexes (workspace.md / workspace-api.ts ordering: recency keysets + importance) ---

CREATE INDEX idx_works_student_recency        ON works (student_id, created_at DESC, id DESC);
CREATE INDEX idx_interactions_student_recency ON interactions (student_id, created_at DESC, id DESC);
CREATE INDEX idx_memories_student_importance  ON memories (student_id, importance DESC, created_at DESC, id DESC);
-- FK-side helpers for retention jobs / preflights.
CREATE INDEX idx_works_tenant        ON works (tenant_id);
CREATE INDEX idx_interactions_tenant ON interactions (tenant_id);
CREATE INDEX idx_memories_tenant     ON memories (tenant_id);
