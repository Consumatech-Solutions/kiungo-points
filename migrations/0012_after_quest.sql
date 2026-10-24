-- T-16: a quest that pays for an item only once another quest has paid for the same item
-- (a written comment on a verified rating pays only after that rating has).
ALTER TABLE quest_versions ADD COLUMN after_quest text REFERENCES quests(id);

-- Which item an award was for (a sale code, a survey…), so a following quest can see the award, and whether it was corrected.
ALTER TABLE awards ADD COLUMN item text;
