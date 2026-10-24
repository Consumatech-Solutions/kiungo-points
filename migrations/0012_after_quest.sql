-- T-16: a quest that pays for an item only once another quest has paid for the same item
-- (a written comment on a verified rating pays only after that rating has).
ALTER TABLE quest_versions ADD COLUMN after_quest text REFERENCES quests(id);
