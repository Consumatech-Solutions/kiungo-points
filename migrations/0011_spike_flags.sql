-- T-11 spike flags: unusual patterns, flagged for a person to review. Never a penalty.
-- The settings are set by admin and kept out of this (public) repository: the rules are public, how abuse is spotted is not.
CREATE TABLE spike_settings (
  kind     text PRIMARY KEY,
  count    integer NOT NULL CHECK (count >= 2),
  minutes  integer NOT NULL CHECK (minutes BETWEEN 1 AND 10080)
);

CREATE TABLE spike_flags (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kiungo_id    text NOT NULL,
  kind         text NOT NULL,
  count        integer NOT NULL,
  at           timestamptz NOT NULL,    -- when the entry that crossed the line happened
  flagged_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz,
  note         text
);
CREATE INDEX spike_flags_open ON spike_flags (kiungo_id, kind, at);

CREATE INDEX entries_read_by_person_kind ON entries_read (kiungo_id, kind, occurred_at);
