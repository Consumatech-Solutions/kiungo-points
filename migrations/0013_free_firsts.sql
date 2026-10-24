-- T-20: a first whose award is corrected is freed for the next member; the row stays as the record.
ALTER TABLE marks ADD COLUMN freed_at timestamptz;
DROP INDEX one_holder_per_first;
CREATE UNIQUE INDEX one_holder_per_first ON marks (mark) WHERE mark LIKE 'first\_%' AND freed_at IS NULL;
