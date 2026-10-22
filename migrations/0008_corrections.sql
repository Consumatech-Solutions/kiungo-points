-- T-07 corrections: a new, opposite award that names the award it cancels. Each award is cancelled at most once.
ALTER TABLE awards ADD COLUMN corrects bigint UNIQUE REFERENCES awards(id);

-- History pages read a member's lines newest first.
DROP INDEX awards_by_person;
CREATE INDEX awards_by_person ON awards (kiungo_id, id);
