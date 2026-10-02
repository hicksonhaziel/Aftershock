-- Apply only to the persistent control database, never to consumer state.
CREATE SCHEMA IF NOT EXISTS aftershock_workbench;
CREATE TABLE IF NOT EXISTS aftershock_workbench.projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  adapter TEXT NOT NULL CHECK (adapter = 'maintained-trade-ledger-v1'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS aftershock_workbench.cases (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES aftershock_workbench.projects(id),
  storage_path TEXT NOT NULL UNIQUE,
  lock_sha256 TEXT NOT NULL,
  provenance JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (project_id, lock_sha256)
);
CREATE TABLE IF NOT EXISTS aftershock_workbench.jobs (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES aftershock_workbench.projects(id),
  case_id UUID NOT NULL REFERENCES aftershock_workbench.cases(id),
  request JSONB NOT NULL,
  request_sha256 TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'QUEUED' CHECK (state IN ('QUEUED','RUNNING','COMPLETED','CANCELLED')),
  verdict TEXT CHECK (verdict IN ('PASS','FAIL','INCONCLUSIVE','UNSUPPORTED','RUNNER_ERROR','CANCELLED')),
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation BETWEEN 0 AND 3),
  worker_id UUID,
  lease_until TIMESTAMPTZ,
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
  next_event INTEGER NOT NULL DEFAULT 0 CHECK (next_event BETWEEN 0 AND 128),
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (project_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS workbench_claims ON aftershock_workbench.jobs(state, lease_until, created_at);
CREATE TABLE IF NOT EXISTS aftershock_workbench.events (
  job_id UUID NOT NULL REFERENCES aftershock_workbench.jobs(id),
  sequence INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (job_id, sequence)
);
