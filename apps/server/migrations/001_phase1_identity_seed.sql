-- 001_phase1_identity_seed.sql — demo tenant + test parents + test students.
--
-- DEV/TEST ONLY. Guard: the migrate runner refuses --seed when GENIUS_X_MODE is
-- live/production or NODE_ENV=production, unless ALLOW_SEED=1 is set explicitly
-- (see scripts/migrate.ts). Fixed UUIDs so tests, demo scripts, and the classroom
-- server can reference them deterministically. Idempotent: ON CONFLICT DO NOTHING
-- throughout (parents uses the bare form — any unique constraint, not just the PK).
--
-- DEMO TENANT ID is the server's Phase-1 default session tenant — keep in sync with
-- the default in apps/server/src/http.ts (buildHttp). Capacity follows the premium
-- model: PREMIUM_CLASSROOM (20-30 students, 4-6 assistants, 1:5) — the tenant-level
-- maxStudents below is the ENROLLMENT ceiling, not the per-classroom cap.
--
-- NO explicit BEGIN/COMMIT: the migrate runner owns the transaction (see migrate.ts).

-- --- demo tenant -----------------------------------------------------------------

INSERT INTO tenants (id, name, type, region, config, capacity, status)
VALUES (
  '11111111-1111-4111-8111-111111111111',
  '示范校区 (Demo Campus)',
  'school',
  'cn-north',
  '{}',
  '{"maxStudents": 200, "maxConcurrentSessions": 5}',
  'active'
)
ON CONFLICT (id) DO NOTHING;

-- --- test parents (one with two children, one with one — multi-child is contract-legal) ---

INSERT INTO parents (id, tenant_id, wechat_open_id, phone_number)
VALUES
  ('22222222-2222-4222-8222-000000000001', '11111111-1111-4111-8111-111111111111', NULL, '+8613800000001'),
  ('22222222-2222-4222-8222-000000000002', '11111111-1111-4111-8111-111111111111', 'wx_demo_parent_2', '+8613800000002')
-- Bare ON CONFLICT: parents has THREE unique constraints (PK, tenant+wechat, tenant+phone);
-- an organically-created parent with a demo phone number must not break re-seeding.
ON CONFLICT DO NOTHING;

-- --- test students (ages spread across the 4-10 range; geniusX blank until Lesson 1) ---

INSERT INTO students (id, tenant_id, parent_id, display_name, age)
VALUES
  ('33333333-3333-4333-8333-000000000001', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000001', '小明', 7),
  ('33333333-3333-4333-8333-000000000002', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000001', '朵朵', 5),
  ('33333333-3333-4333-8333-000000000003', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000002', '轩轩', 9),
  ('33333333-3333-4333-8333-000000000004', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000002', '乐乐', 6)
ON CONFLICT (id) DO NOTHING;

-- --- guardian consents (exactly one per student; v1.0 policy) ----------------------
-- One student opts into parent co-work + media usage so downstream gates have both
-- branches to test against.

INSERT INTO guardian_consents (student_id, parent_id, consent_version, data_retention_agreed, parent_co_work_allowed, media_usage_allowed)
VALUES
  ('33333333-3333-4333-8333-000000000001', '22222222-2222-4222-8222-000000000001', 'v1.0', TRUE, FALSE, FALSE),
  ('33333333-3333-4333-8333-000000000002', '22222222-2222-4222-8222-000000000001', 'v1.0', TRUE, FALSE, FALSE),
  ('33333333-3333-4333-8333-000000000003', '22222222-2222-4222-8222-000000000002', 'v1.0', TRUE, TRUE,  TRUE),
  ('33333333-3333-4333-8333-000000000004', '22222222-2222-4222-8222-000000000002', 'v1.0', TRUE, FALSE, FALSE)
ON CONFLICT (student_id) DO NOTHING;
