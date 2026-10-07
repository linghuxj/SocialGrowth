BEGIN;
-- Initial direction and exact operator scope. Neither task production nor a
-- device/action grant is implied. Repeated original commands cannot call the
-- model again or create a second approval, even after a lost response.
CREATE TABLE socialgrowth_product.project_direction_attempts (
  attempt_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL,
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  snapshot_digest text NOT NULL CHECK(snapshot_digest ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK(state IN ('requested','proposed','unavailable','facts_changed')),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  result_deadline timestamptz NOT NULL DEFAULT clock_timestamp()+interval '60 seconds',
  proposal_id uuid,
  UNIQUE(actor_id,request_key),
  CHECK((state='proposed')=(proposal_id IS NOT NULL))
);
CREATE TABLE socialgrowth_product.project_direction_proposals (
  proposal_id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  record jsonb NOT NULL CHECK(jsonb_typeof(record)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(proposal_id,project_id),
  CHECK((record->>'proposalId') IS NOT DISTINCT FROM proposal_id::text),
  CHECK((record->>'projectId') IS NOT DISTINCT FROM project_id::text)
);
ALTER TABLE socialgrowth_product.project_direction_attempts ADD FOREIGN KEY(proposal_id,project_id) REFERENCES socialgrowth_product.project_direction_proposals(proposal_id,project_id);
CREATE TABLE socialgrowth_product.project_direction_approvals (
  approval_id uuid PRIMARY KEY,
  project_id uuid NOT NULL UNIQUE REFERENCES socialgrowth_product.projects(project_id),
  proposal_id uuid NOT NULL UNIQUE REFERENCES socialgrowth_product.project_direction_proposals(proposal_id),
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL,
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  record jsonb NOT NULL CHECK(jsonb_typeof(record)='object'),
  UNIQUE(actor_id,request_key),
  FOREIGN KEY(proposal_id,project_id) REFERENCES socialgrowth_product.project_direction_proposals(proposal_id,project_id),
  CHECK((record->>'approvalId') IS NOT DISTINCT FROM approval_id::text),
  CHECK((record->>'confirmedByOperatorId') IS NOT DISTINCT FROM actor_id::text),
  CHECK((record->'proposal'->>'proposalId') IS NOT DISTINCT FROM proposal_id::text),
  CHECK((record->'proposal'->>'projectId') IS NOT DISTINCT FROM project_id::text),
  CHECK((record->>'status') IS NOT DISTINCT FROM 'approved_waiting_readiness')
);
CREATE FUNCTION socialgrowth_product.reject_direction_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Direction and approval history is immutable'; END $$;
CREATE TRIGGER direction_proposal_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.project_direction_proposals FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_direction_history_change();
CREATE TRIGGER direction_approval_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.project_direction_approvals FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_direction_history_change();
COMMIT;
