-- 003_phase3_share_tokens.sql — Phase 3: parent share capability tokens.
--
-- Typed contract:  packages/contracts/src/parent-share.ts  (frozen v1)
-- Prose contract:  docs/contracts/parent-share.md (frozen v1)
--
-- Capability model: the RAW token never touches the database — only its sha256 hex hash.
-- One (student, lesson) artifact per token; re-mint issues a NEW row (old ones serve
-- until expiry). Tenant isolation via the composite student FK (001/002 pattern).
-- NO BEGIN/COMMIT: the migrate runner owns the transaction.

CREATE TABLE share_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- sha256 hex of the raw capability token (the raw value is never stored or logged).
  token_hash  TEXT        NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  student_id  UUID        NOT NULL,
  tenant_id   UUID        NOT NULL,
  lesson_id   TEXT        NOT NULL CHECK (btrim(lesson_id) <> '' AND length(lesson_id) <= 200),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  CONSTRAINT share_tokens_expiry_sane CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '366 days'),

  -- Data-layer tenant isolation (001/002 pattern).
  CONSTRAINT share_tokens_student_same_tenant FOREIGN KEY (student_id, tenant_id) REFERENCES students(id, tenant_id)
);

-- Lookup is by hash (UNIQUE above backs it); admin listing/purge by student + expiry.
CREATE INDEX idx_share_tokens_student ON share_tokens (student_id, created_at DESC);
CREATE INDEX idx_share_tokens_expiry  ON share_tokens (expires_at);
