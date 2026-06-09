-- 001_phase1_identity.sql — Phase 1: persistent identity & enrollment.
--
-- Typed contract:  packages/contracts/src/identity.ts  (frozen v1)
-- Prose contract:  docs/contracts/identity.md, docs/contracts/enrollment.md (frozen v1)
--
-- Conventions:
--   * snake_case columns ↔ camelCase contract fields (mapping is mechanical).
--   * updated_at is APP-MANAGED (the Identity Service sets it on every UPDATE);
--     no trigger, to keep migration surface minimal.
--   * Tenant isolation is enforced AT THE DATA LAYER where possible:
--     students carries a composite FK (parent_id, tenant_id) → parents(id, tenant_id),
--     so a student can never reference a parent from another tenant.
--   * Soft delete (status on students/parents) is deliberately ABSENT — Phase 8
--     (see identity.md → Lifecycle → Soft delete). Only tenants has status in Phase 1.
--
-- Requires PostgreSQL 14+ (gen_random_uuid() is core since 13; JSONB, TIMESTAMPTZ).
--
-- NO explicit BEGIN/COMMIT here: the migrate runner (scripts/migrate.ts) wraps each
-- file + its schema_migrations journal row in ONE transaction (atomic apply-or-skip).

-- --- tenants — organizational unit (city / school / partner org) -----------------

CREATE TABLE tenants (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  type        TEXT        NOT NULL CHECK (type IN ('city', 'school', 'partner')),
  region      TEXT        NOT NULL,                       -- e.g. cn-north / cn-east / cn-south
  -- TenantConfig (all optional overrides) — must be a JSON object (not jsonb null/array/scalar).
  config      JSONB       NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(config) = 'object'),
  -- TenantCapacity — contract requires BOTH numeric fields (identity.ts). NULL-safe CHECK:
  -- `->` yields SQL NULL on missing keys and a NULL CHECK passes, so we must assert object
  -- shape + key presence explicitly. No DEFAULT: omission fails loudly (manual SQL is the
  -- blessed Phase-1 tenant-creation path, so the DB is the validation boundary here).
  capacity    JSONB       NOT NULL CHECK (
                jsonb_typeof(capacity) = 'object'
                AND capacity ? 'maxStudents'
                AND capacity ? 'maxConcurrentSessions'
                AND jsonb_typeof(capacity -> 'maxStudents') = 'number'
                AND jsonb_typeof(capacity -> 'maxConcurrentSessions') = 'number'
              ),
  status      TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- --- parents — guardian accounts ------------------------------------------------

CREATE TABLE parents (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id),
  -- Optional in Phase 1, but NEVER empty string: these are the idempotency keys for
  -- POST /parents — '' would make two unrelated families "equal" under the UNIQUE
  -- constraints below. NULL passes a CHECK, so optionality is unaffected.
  wechat_open_id  TEXT        CHECK (wechat_open_id <> ''),  -- WeChat = Phase 6+
  phone_number    TEXT        CHECK (phone_number <> ''),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Drives POST /parents idempotency: a plain duplicate returns the existing parent
  -- (200); 409 PARENT_ALREADY_EXISTS is reserved for ambiguous conflicts only
  -- (enrollment.md → Error codes). NULLs are distinct, so parents without
  -- phone/wechat don't collide.
  CONSTRAINT parents_tenant_wechat_unique UNIQUE (tenant_id, wechat_open_id),
  CONSTRAINT parents_tenant_phone_unique  UNIQUE (tenant_id, phone_number),

  -- FK target for the students composite FK (tenant-isolation at the data layer).
  CONSTRAINT parents_id_tenant_unique     UNIQUE (id, tenant_id)
);

-- --- students — permanent child profiles ----------------------------------------

CREATE TABLE students (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id),
  parent_id     UUID        NOT NULL REFERENCES parents(id),
  -- Stricter than the contract preflight ("length > 0"): also rejects space-only names
  -- (intentional narrowing; the Step-3 zod schema mirrors it so 400 fires before the DB).
  display_name  TEXT        NOT NULL CHECK (btrim(display_name) <> ''),
  age           INTEGER     NOT NULL CHECK (age >= 4 AND age <= 10),     -- product rule: 4-10
  enrolled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Genius X companion state (GeniusXProfile) — blank at enrollment, populated by the
  -- Classroom Service during/after Lesson 1 (server-owned; never parent-writable).
  genius_x_name                TEXT,
  genius_x_avatar_url          TEXT,
  genius_x_personality_tag     TEXT,
  genius_x_background_setting  TEXT,
  genius_x_birthday_speech     TEXT,

  -- Progress tracking (StudentProgress) — server-owned. Contract type is string[]:
  -- reject NULL elements (array_position also errors on multidim input, rejecting it too).
  completed_lesson_ids  TEXT[]   NOT NULL DEFAULT '{}' CHECK (array_position(completed_lesson_ids, NULL) IS NULL),
  current_phase         INTEGER  NOT NULL DEFAULT 1 CHECK (current_phase >= 1 AND current_phase <= 4),
  badges                TEXT[]   NOT NULL DEFAULT '{}' CHECK (array_position(badges, NULL) IS NULL),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Data-layer tenant isolation: the student's tenant MUST be its parent's tenant.
  -- (Also the executable form of the identity.md preflight "student/parent tenant match".)
  CONSTRAINT students_parent_same_tenant
    FOREIGN KEY (parent_id, tenant_id) REFERENCES parents(id, tenant_id),

  -- FK target for guardian_consents: ties the consenting parent to the student's own parent.
  CONSTRAINT students_id_parent_unique UNIQUE (id, parent_id)
);

-- --- guardian_consents — versioned consent, exactly one row per student ---------

CREATE TABLE guardian_consents (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),  -- storage-internal; not on the wire
  student_id             UUID        NOT NULL,
  parent_id              UUID        NOT NULL REFERENCES parents(id),
  consent_given_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consent_version        TEXT        NOT NULL,            -- consent-policy version, e.g. 'v1.0'

  -- A consent row with data_retention_agreed = false is invalid state: enrollment
  -- without retention agreement is rejected 400 CONSENT_REQUIRED (enrollment.md).
  -- NO DEFAULT: consent is an explicit legal affirmation — a writer that omits the
  -- column must fail loudly, never have omission recorded as agreement.
  data_retention_agreed  BOOLEAN     NOT NULL CHECK (data_retention_agreed = TRUE),
  parent_co_work_allowed BOOLEAN     NOT NULL DEFAULT FALSE,  -- gates Phase 6 parent co-work
  media_usage_allowed    BOOLEAN     NOT NULL DEFAULT FALSE,  -- gates showcase/promotion use
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- storage-internal; not on the wire

  -- One CURRENT consent per student; updates overwrite (prior not retained — audit
  -- log is a future extension, identity.md → Future extensions).
  CONSTRAINT guardian_consents_student_unique UNIQUE (student_id),

  -- Data-layer guardianship integrity: the consenting parent MUST be the student's own
  -- enrolling parent (Phase 1 contract: single parent per student; multi-parent is a
  -- documented future extension). Tenant match is transitive via students.parent_id.
  CONSTRAINT consents_match_student_parent
    FOREIGN KEY (student_id, parent_id) REFERENCES students(id, parent_id) ON DELETE CASCADE
);

-- --- indexes (identity.md → Performance) -----------------------------------------
-- parents(tenant_id, wechat_open_id) and (tenant_id, phone_number) lookups are served
-- by their UNIQUE constraints' backing indexes; tenants by id via the PK.

CREATE INDEX idx_students_tenant ON students(tenant_id);
CREATE INDEX idx_students_parent ON students(parent_id);
CREATE INDEX idx_parents_tenant  ON parents(tenant_id);
-- Future-proofing for the Phase-6 co-work gate (consents-by-parent lookups).
CREATE INDEX idx_guardian_consents_parent ON guardian_consents(parent_id);
