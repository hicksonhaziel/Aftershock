ALTER TABLE aftershock_workbench.jobs ALTER COLUMN case_id DROP NOT NULL;
CREATE TABLE IF NOT EXISTS aftershock_workbench.captures (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES aftershock_workbench.projects(id),
  capture_id UUID NOT NULL,
  storage_path TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  summary JSONB NOT NULL,
  reference JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(project_id, manifest_sha256)
);
ALTER TABLE aftershock_workbench.captures ADD COLUMN IF NOT EXISTS reference_path TEXT;
