-- T-03 progress and limits.

-- The things counted in a period: items paid (surveys, shops…), sections collected, steps reached.
ALTER TABLE quest_progress ADD COLUMN counted text[] NOT NULL DEFAULT '{}';

ALTER TABLE awards
  ADD COLUMN step text,     -- the step or milestone that paid, if any
  ADD COLUMN reason text;   -- why a quest paid 0 ('weekly_limit'…), or why an award was corrected

-- References only (ADR-005): which item an entry is about (a survey, a shop, an invited person) and its evidence.
ALTER TABLE standin_entries
  ADD COLUMN item text,
  ADD COLUMN evidence text;
