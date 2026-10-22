-- T-05 levels. The date each level was first reached; levels never go down.
CREATE TABLE levels_reached (
  kiungo_id   text NOT NULL,
  level       text NOT NULL CHECK (level IN ('Seed', 'Sprout', 'Root', 'Fruit', 'Seedkeeper')),
  reached_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kiungo_id, level)
);
