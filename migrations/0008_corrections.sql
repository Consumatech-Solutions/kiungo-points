-- T-07 corrections: a new, opposite award that names the award it cancels. Each award is cancelled at most once.
ALTER TABLE awards ADD COLUMN corrects bigint UNIQUE REFERENCES awards(id);
