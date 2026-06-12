-- Step-4 review fixes (workspace.md v1.4 / world.md v1.2):
--
-- 1. memories.seq — the SAME created_at-tie fix migration 005 gave works: "newest
--    episode" (the visit greeting), the diary top-5, and the session-episode composition
--    order tied on ms-resolution created_at would pick arbitrarily. seq IS insertion order.
ALTER TABLE memories ADD COLUMN seq BIGSERIAL;
CREATE INDEX idx_memories_student_key_seq ON memories (student_id, key, seq);

-- 2. Diary idempotency, DB-ENFORCED (probe-proven race: two concurrent reflections both
--    passed the read-check and wrote duplicate diary entries). One diary entry per
--    (student, lesson), forever — a re-taken lesson never duplicates; the losing writer
--    maps the conflict to reflection_skipped/already_written.
CREATE UNIQUE INDEX uniq_memories_diary_per_lesson
  ON memories (student_id, lesson_id) WHERE key = 'self_narrative';
