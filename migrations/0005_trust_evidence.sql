-- T-04 trust and never-earns.

-- The evidence a quest needs before it pays: a sale code, or a photo confirmed by another member.
ALTER TABLE quest_versions ADD COLUMN evidence text CHECK (evidence IN ('sale_code', 'photo'));
UPDATE quest_versions SET evidence = 'sale_code' WHERE quest_id = 'rating.verified';

-- What became of an entry no quest could take, such as 'never_earns', so a redelivery gets the same answer.
ALTER TABLE entries_read ADD COLUMN outcome text;
