-- T-08 missions: a unit's shared goal, paid once, all or nothing, to everyone who contributed.

ALTER TABLE quests ADD COLUMN unit text;  -- empty for core quests; the unit for its missions and local quests
ALTER TABLE quests DROP CONSTRAINT quests_template_check,
  ADD CONSTRAINT quests_template_check CHECK (template IN ('repeat', 'collect', 'steps', 'streak', 'mission')),
  ADD CONSTRAINT missions_have_a_unit CHECK (template <> 'mission' OR unit IS NOT NULL);

-- The unit's shared counter for one period. Locked while an entry is applied.
CREATE TABLE mission_progress (
  quest_id    text NOT NULL REFERENCES quests(id),
  unit        text NOT NULL,
  period_key  text NOT NULL,
  count       integer NOT NULL DEFAULT 0,
  paid_at     timestamptz,
  PRIMARY KEY (quest_id, unit, period_key)
);

CREATE TABLE mission_contributors (
  quest_id    text NOT NULL,
  unit        text NOT NULL,
  period_key  text NOT NULL,
  kiungo_id   text NOT NULL,
  PRIMARY KEY (quest_id, unit, period_key, kiungo_id),
  FOREIGN KEY (quest_id, unit, period_key) REFERENCES mission_progress(quest_id, unit, period_key)
);

-- Stand-in identity rail: the units a person belongs to.
ALTER TABLE standin_people ADD COLUMN units text[] NOT NULL DEFAULT '{}';
