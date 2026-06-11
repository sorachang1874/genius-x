-- agent-session.md v1 (Phase 6.5 Step 3): the playground UNLOCK door. A SEPARATE token
-- class from parent_access_tokens (parent-surface.md v1.2 rule: risk acceptances never
-- transfer between classes): ONE student, playground scope, session TTL = quota + grace.
-- Minting REVOKES any prior unexpired token for the student (the token IS the session
-- lock). NOTE gate ⑤ (agent-session.md rule 3): this table is the PARENT-written unlock
-- mechanism — child playground data tables (agent_sessions etc.) stay blocked until the
-- data-and-privacy upgrade lands.

CREATE TABLE playground_session_tokens (
  token_hash  TEXT        PRIMARY KEY CHECK (length(token_hash) = 64), -- sha256 hex ONLY
  student_id  UUID        NOT NULL,
  tenant_id   UUID        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  -- set when a newer mint supersedes this token (one active session per student)
  revoked_at  TIMESTAMPTZ,
  -- session TTL sanity: quota ceiling (30) + grace (5) — never a long-lived credential
  CONSTRAINT pst_ttl_sane CHECK (expires_at > created_at AND expires_at <= created_at + INTERVAL '35 minutes'),
  -- tenant isolation: the composite-FK discipline (students_id_tenant_unique, migration 001)
  CONSTRAINT pst_student_same_tenant FOREIGN KEY (student_id, tenant_id) REFERENCES students(id, tenant_id)
);
-- ONE active (unrevoked) token per student, DB-enforced (rule 8): the mint revokes ALL
-- prior unrevoked rows (expired ones too — harmless) so this UNIQUE partial index holds
-- under any interleaving; a concurrent-mint loser hits the unique violation and retries.
CREATE UNIQUE INDEX idx_playground_tokens_active ON playground_session_tokens (student_id) WHERE revoked_at IS NULL;
-- daily-quota accounting scans today's rows per student
CREATE INDEX idx_playground_tokens_daily ON playground_session_tokens (student_id, created_at);
