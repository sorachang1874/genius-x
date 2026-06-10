-- Phase 4 (agent-context.md safety parity item 3): per-exchange safety status, so any
-- future reader (context building, parent curation, analytics) can exclude or re-review
-- filtered rows. The recorder sets it from the gateway's AiMeta.filtered signal.
--
-- BACKFILL CAVEAT (workspace.md v1.1 pending-amendments): DEFAULT 'ok' on pre-migration
-- rows is a labeling DEFAULT, not evidence of review — readers injecting pre-migration
-- transcripts into model context must exclude/re-review rows with output_degraded = true.

ALTER TABLE interactions
  ADD COLUMN safety TEXT NOT NULL DEFAULT 'ok'
  CONSTRAINT interactions_safety_valid CHECK (safety IN ('ok', 'input_filtered', 'output_filtered'));
