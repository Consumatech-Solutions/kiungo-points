-- T-19: the member who proposed each version of a unit's challenge (a Kiungo ID; null for the admin and core quests).
ALTER TABLE quest_versions ADD COLUMN proposed_by text;
