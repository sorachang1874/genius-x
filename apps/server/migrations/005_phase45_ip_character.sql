-- Phase 4.5 (docs/contracts/ip-character.md v1): the IP character entity — the product
-- anchor. Layered model: base_canon (locked — brand DNA + essential 伙伴 form; changes
-- only via lead-serialized brand migration), surface (child-refined through scene
-- outcomes; every accepted refinement = a version), versions append-only (the growth
-- timeline). Tenant isolation = the composite-FK pattern of 001/002/003.

CREATE TABLE ip_characters (
  student_id  UUID        PRIMARY KEY,
  tenant_id   UUID        NOT NULL,
  -- { brandStyleVersion, baseForm } — bounded (a JSONB blob must not smuggle bulk data)
  base_canon  JSONB       NOT NULL CHECK (jsonb_typeof(base_canon) = 'object' AND pg_column_size(base_canon) <= 8192),
  -- { name?, appearanceRef?, appearanceTraits?, personality?, backstory? } — service
  -- enforces per-field caps (name<=50, traits<=10x50, personality/backstory<=500 chars)
  surface     JSONB       NOT NULL CHECK (jsonb_typeof(surface) = 'object' AND pg_column_size(surface) <= 16384),
  version     INT         NOT NULL CHECK (version >= 1),
  updated_by  JSONB       NOT NULL CHECK (jsonb_typeof(updated_by) = 'object'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ip_characters_student_same_tenant FOREIGN KEY (student_id, tenant_id) REFERENCES students(id, tenant_id)
);

CREATE TABLE ip_character_versions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID        NOT NULL,
  tenant_id   UUID        NOT NULL,
  version     INT         NOT NULL CHECK (version >= 1),
  base_canon  JSONB       NOT NULL CHECK (jsonb_typeof(base_canon) = 'object' AND pg_column_size(base_canon) <= 8192),
  surface     JSONB       NOT NULL CHECK (jsonb_typeof(surface) = 'object' AND pg_column_size(surface) <= 16384),
  updated_by  JSONB       NOT NULL CHECK (jsonb_typeof(updated_by) = 'object'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- contiguity/idempotency preflights key off this (ip-character.md Validation)
  CONSTRAINT ip_character_versions_unique UNIQUE (student_id, version),
  CONSTRAINT ip_character_versions_student_same_tenant FOREIGN KEY (student_id, tenant_id) REFERENCES students(id, tenant_id)
);

-- (Growth-timeline reads are served by the UNIQUE(student_id, version) constraint's
-- implicit index — a separate index would be pure write amplification.)

-- Works lineage (workspace.md v1.2 pending-amendment landed): artifacts link to the
-- character version they depict; NULL = pre-4.5 rows / non-character artifacts
-- (absence of lineage on character art is traced `work_lineage_missing`, never rejected).
ALTER TABLE works ADD COLUMN ip_character_version INT CHECK (ip_character_version >= 1);

-- MONOTONIC insertion discriminator (review blocker): created_at resolves to the
-- millisecond on PGlite (and offers no order guarantee on PG either), and id is a RANDOM
-- uuid — "latest per type" picks (parent curation finals, certificate hero, backfill
-- avatar) tied on created_at would select an arbitrary draft. seq IS insertion order.
ALTER TABLE works ADD COLUMN seq BIGSERIAL;
CREATE INDEX idx_works_student_lesson_seq ON works (student_id, lesson_id, seq);
