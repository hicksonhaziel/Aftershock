-- Apply only in a new database owned by one Aftershock run.
BEGIN;
CREATE TABLE aftershock_owner (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  ownership_token UUID NOT NULL,
  run_id TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1)
);
CREATE TABLE consumer_events (
  event_id TEXT PRIMARY KEY,
  program TEXT NOT NULL,
  signature TEXT NOT NULL,
  instruction_path INTEGER[] NOT NULL CHECK (cardinality(instruction_path) > 0),
  event_ordinal NUMERIC(20,0) NOT NULL CHECK (event_ordinal >= 0),
  projection_version TEXT NOT NULL,
  slot NUMERIC(20,0) NOT NULL CHECK (slot >= 0),
  mint TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  sol_lamports NUMERIC(20,0) NOT NULL CHECK (sol_lamports >= 0),
  token_base_units NUMERIC(20,0) NOT NULL CHECK (token_base_units >= 0),
  UNIQUE(program, signature, instruction_path, event_ordinal, projection_version)
);
CREATE TABLE consumer_totals (
  program TEXT NOT NULL,
  mint TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  event_count NUMERIC(30,0) NOT NULL CHECK (event_count >= 0),
  sol_lamports NUMERIC(40,0) NOT NULL CHECK (sol_lamports >= 0),
  token_base_units NUMERIC(40,0) NOT NULL CHECK (token_base_units >= 0),
  PRIMARY KEY(program, mint, side)
);
CREATE TABLE consumer_checkpoints (
  consumer_id TEXT PRIMARY KEY,
  last_delivery NUMERIC(20,0) NOT NULL CHECK (last_delivery >= 0),
  last_event_id TEXT
);
COMMIT;
