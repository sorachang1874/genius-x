-- identity.md v1.1 (founder-ratified 2026-06-10, APP-PRD Q6): physical-carrier use of
-- the child's works & IP character (cards/cups/stickers/growth books — decision ④) is a
-- DISTINCT consent purpose from digital showcase (media_usage_allowed). Collected at
-- enrollment from now on so the merch path never needs a re-authorization campaign.
-- Existing rows default FALSE (never assume consent retroactively).

ALTER TABLE guardian_consents
  ADD COLUMN ip_physical_use_allowed BOOLEAN NOT NULL DEFAULT FALSE;
