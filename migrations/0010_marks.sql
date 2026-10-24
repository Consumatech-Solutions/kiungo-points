-- T-10 marks: Founding member, and the firsts (activities.md §9).
CREATE TABLE marks (
  id         bigint GENERATED ALWAYS AS IDENTITY,
  kiungo_id  text NOT NULL,
  mark       text NOT NULL,   -- 'founding_member', 'first_in_unit:matete', 'first_in_country:CD', 'first_in_language:ln'
  given_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kiungo_id, mark)
);
-- Each first belongs to one person only.
CREATE UNIQUE INDEX one_holder_per_first ON marks (mark) WHERE mark LIKE 'first\_%';

-- The firsts pay 25 points each. They watch no activity: the points system gives them when it reads a member's entry.
INSERT INTO quests (id, quest_line, status, template) VALUES
  ('first.unit', 'firsts', 'live', 'repeat'), ('first.country', 'firsts', 'live', 'repeat'), ('first.language', 'firsts', 'live', 'repeat');
INSERT INTO quest_versions (quest_id, version, title, watches, target, period, each_item, points, trust_needed, valid_from) VALUES
  ('first.unit', 1, 'First member in your community unit', '{}', 1, 'once', 'ever', 25, 'joined', '2026-01-01T00:00:00Z'),
  ('first.country', 1, 'First member in your country', '{}', 1, 'once', 'ever', 25, 'joined', '2026-01-01T00:00:00Z'),
  ('first.language', 1, 'First member speaking your language', '{}', 1, 'once', 'ever', 25, 'joined', '2026-01-01T00:00:00Z');

-- Stand-in identity rail: country and languages.
ALTER TABLE standin_people
  ADD COLUMN country text CHECK (country ~ '^[A-Z]{2}$'),
  ADD COLUMN languages text[] NOT NULL DEFAULT '{}';
