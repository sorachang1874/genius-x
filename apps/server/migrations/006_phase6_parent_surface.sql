-- Phase 6 (docs/contracts/parent-surface.md v1): the parent's AUTHENTICATED home surface.
-- parent_access_tokens = the PROVEN Phase-3 capability machinery, parent-scoped (all of
-- one parent's children; SMS/WeChat mint replaces the operator mint later behind the same
-- verifier seam). parent_notes = co-working v1: a reviewed note the companion relays once.

CREATE TABLE parent_access_tokens (
  token_hash  TEXT        PRIMARY KEY CHECK (length(token_hash) = 64), -- sha256 hex ONLY (raw never stored)
  parent_id   UUID        NOT NULL,
  tenant_id   UUID        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  CONSTRAINT pat_expiry_sane CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '366 days'),
  -- tenant isolation: the composite-FK pattern (parents_id_tenant_unique, migration 001)
  CONSTRAINT pat_parent_same_tenant FOREIGN KEY (parent_id, tenant_id) REFERENCES parents(id, tenant_id)
);
CREATE INDEX idx_parent_access_tokens_parent ON parent_access_tokens (parent_id);

CREATE TABLE parent_notes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id   UUID        NOT NULL,
  student_id  UUID        NOT NULL,
  tenant_id   UUID        NOT NULL,
  -- reviewed at the boundary BEFORE storage; bounded (contract: 1-200 chars)
  note        TEXT        NOT NULL CHECK (btrim(note) <> '' AND length(note) <= 200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULL until the companion relays it (context injection marks it, exactly once)
  relayed_at  TIMESTAMPTZ,
  CONSTRAINT pn_parent_same_tenant  FOREIGN KEY (parent_id, tenant_id)  REFERENCES parents(id, tenant_id),
  CONSTRAINT pn_student_same_tenant FOREIGN KEY (student_id, tenant_id) REFERENCES students(id, tenant_id)
);
-- the relay read: unrelayed notes per student, newest-first
CREATE INDEX idx_parent_notes_unrelayed ON parent_notes (student_id, created_at DESC) WHERE relayed_at IS NULL;
