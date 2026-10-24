-- T-17: the members who tapped "I'm in" on a member's suggested challenge. Not the notebook: withdrawing deletes the row.
CREATE TABLE quest_backers (
  quest_id   text NOT NULL REFERENCES quests(id),
  kiungo_id  text NOT NULL,
  since      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (quest_id, kiungo_id)
);
