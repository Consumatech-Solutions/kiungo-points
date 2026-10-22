-- T-01 walking skeleton. The points tables, then the stand-in rails (removed in T-12).

-- The quest board. Versions are only ever added (ADR-004).
CREATE TABLE quests (
  id          text PRIMARY KEY,
  quest_line  text NOT NULL,
  status      text NOT NULL CHECK (status IN ('draft', 'live', 'paused', 'ended'))
);

CREATE TABLE quest_versions (
  quest_id      text NOT NULL REFERENCES quests(id),
  version       integer NOT NULL,
  watches       text NOT NULL,          -- the kind of activity this quest counts
  target        integer NOT NULL CHECK (target > 0),
  period        text NOT NULL CHECK (period IN ('once', 'daily', 'weekly', 'monthly')),
  points        integer NOT NULL CHECK (points > 0),
  trust_needed  text NOT NULL CHECK (trust_needed IN ('joined', 'vouched', 'verified')),
  valid_from    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (quest_id, version)
);

-- A reference to each activity entry read, never its content (ADR-005).
CREATE TABLE entries_read (
  entry_id     text PRIMARY KEY,
  kiungo_id    text NOT NULL,
  kind         text NOT NULL,
  occurred_at  timestamptz NOT NULL,
  carriage     text NOT NULL,
  read_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quest_progress (
  kiungo_id    text NOT NULL,
  quest_id     text NOT NULL REFERENCES quests(id),
  period_key   text NOT NULL,           -- 'once' for one-off quests
  count        integer NOT NULL DEFAULT 0,
  completions  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (kiungo_id, quest_id, period_key)
);

-- The notebook: insert only.
CREATE TABLE awards (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entry_id       text REFERENCES entries_read(entry_id),
  kiungo_id      text NOT NULL,
  quest_id       text NOT NULL,
  quest_version  integer NOT NULL,
  points         integer NOT NULL,
  quest_line     text NOT NULL,
  awarded_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (quest_id, quest_version) REFERENCES quest_versions(quest_id, version)
);
CREATE INDEX awards_by_person ON awards (kiungo_id);

CREATE FUNCTION awards_insert_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'awards are insert only; correct with a new award';
END $$;
CREATE TRIGGER awards_no_update BEFORE UPDATE OR DELETE ON awards
  FOR EACH ROW EXECUTE FUNCTION awards_insert_only();

-- The first quest.
INSERT INTO quests (id, quest_line, status) VALUES ('identity.phone_confirmed', 'picture', 'live');
INSERT INTO quest_versions (quest_id, version, watches, target, period, points, trust_needed, valid_from)
  VALUES ('identity.phone_confirmed', 1, 'identity.phone_confirmed', 1, 'once', 10, 'joined', '2026-01-01T00:00:00Z');

-- Stand-in identity rail.
CREATE TABLE standin_people (
  kiungo_id   text PRIMARY KEY CHECK (kiungo_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  trust       text NOT NULL CHECK (trust IN ('joined', 'vouched', 'verified')),
  timezone    text NOT NULL,
  joined_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE standin_permissions (
  kiungo_id  text NOT NULL REFERENCES standin_people(kiungo_id),
  reader     text NOT NULL,             -- e.g. 'kiungo-points'
  PRIMARY KEY (kiungo_id, reader)
);

-- Stand-in activity rail.
CREATE TABLE standin_carriages (
  name          text PRIMARY KEY,
  key_hash      text NOT NULL UNIQUE,
  may_write     text[] NOT NULL         -- kinds of activity this carriage may write
);

CREATE TABLE standin_entries (
  entry_id     text PRIMARY KEY,
  carriage     text NOT NULL REFERENCES standin_carriages(name),
  carriage_key text NOT NULL,
  kiungo_id    text NOT NULL REFERENCES standin_people(kiungo_id),
  kind         text NOT NULL,
  occurred_at  timestamptz NOT NULL,
  UNIQUE (carriage, carriage_key)
);
