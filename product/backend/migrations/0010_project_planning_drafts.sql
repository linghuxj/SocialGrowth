BEGIN;
-- Draft inputs only. No approval, running cycle, stage switch or executor grant.
CREATE TABLE socialgrowth_product.project_planning_drafts (
  project_id uuid PRIMARY KEY REFERENCES socialgrowth_product.projects(project_id),
  draft_version bigint NOT NULL CHECK (draft_version BETWEEN 1 AND 9007199254740991),
  inputs jsonb NOT NULL CHECK (jsonb_typeof(inputs) = 'object'),
  status text NOT NULL DEFAULT 'unapproved_draft' CHECK (status = 'unapproved_draft'),
  saved_by_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE socialgrowth_product.project_planning_commands (
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 8 AND 200),
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  payload_digest bytea NOT NULL CHECK (octet_length(payload_digest)=32),
  PRIMARY KEY (actor_id, request_key)
);
COMMIT;
