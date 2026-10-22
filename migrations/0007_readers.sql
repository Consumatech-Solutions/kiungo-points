-- T-06 carriages and permissions. One key per carriage, kept hashed, for writing to the rail and reading points.
CREATE TABLE readers (
  name        text PRIMARY KEY,
  key_hash    text NOT NULL UNIQUE,
  active      boolean NOT NULL DEFAULT true,
  changed_at  timestamptz NOT NULL DEFAULT now()
);

-- The stand-in rail keeps only what each carriage may write; its key now lives in readers.
INSERT INTO readers (name, key_hash) SELECT name, key_hash FROM standin_carriages;
ALTER TABLE standin_carriages DROP COLUMN key_hash;
