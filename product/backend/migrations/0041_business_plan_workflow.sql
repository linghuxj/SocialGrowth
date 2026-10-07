BEGIN;

-- Distinguish a persisted logical attempt's origin. Historical immutable rows
-- retain their legacy label; reservation_operator_id is never the run initiator.
ALTER TABLE socialgrowth_product.business_plan_task_attempts
  ADD COLUMN attempt_origin text NOT NULL DEFAULT 'legacy_operator_request'
    CHECK (attempt_origin IN ('legacy_operator_request','operator_request','scheduled_plan')),
  ADD COLUMN triggering_operator_id uuid REFERENCES socialgrowth_product.operators(operator_id),
  ADD COLUMN plan_approval_id uuid REFERENCES socialgrowth_product.project_direction_approvals(approval_id),
  ADD CONSTRAINT business_plan_attempt_origin_provenance CHECK (
    (attempt_origin='legacy_operator_request' AND triggering_operator_id IS NULL AND plan_approval_id IS NULL)
    OR (attempt_origin='operator_request' AND triggering_operator_id IS NOT NULL AND plan_approval_id IS NULL)
    OR (attempt_origin='scheduled_plan' AND triggering_operator_id IS NULL AND plan_approval_id IS NOT NULL)
  );

CREATE TABLE socialgrowth_product.business_plan_workflow_jobs (
  workflow_id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL UNIQUE,
  task_attempt_id uuid UNIQUE REFERENCES socialgrowth_product.business_plan_task_attempts(task_attempt_id),
  scope_snapshot jsonb NOT NULL CHECK (jsonb_typeof(scope_snapshot)='object'),
  scope_fingerprint bytea NOT NULL CHECK (octet_length(scope_fingerprint)=32),
  state text NOT NULL CHECK (state IN ('blocked','queued','claimed','running','submission_unknown','verified','not_published','failed')),
  submission_state text NOT NULL CHECK (submission_state IN ('not_started','in_progress','unknown','verified_published','verified_not_published')),
  operation_id text CHECK (operation_id IS NULL OR length(operation_id) BETWEEN 1 AND 200),
  operation_state text CHECK (operation_state IS NULL OR operation_state IN ('queued','claimed','running','submission_unknown','verified','not_published','failed')),
  claim_id uuid UNIQUE,
  original_claim_id uuid UNIQUE,
  claim_owner text CHECK (claim_owner IS NULL OR length(claim_owner) BETWEEN 1 AND 120),
  lease_until timestamptz,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(blockers)='array' AND jsonb_array_length(blockers)<=64),
  verified_result_id text CHECK (verified_result_id IS NULL OR length(verified_result_id) BETWEEN 1 AND 200),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(project_id,task_id) REFERENCES socialgrowth_product.business_plan_tasks(project_id,task_id),
  CHECK ((claim_id IS NULL) = (claim_owner IS NULL)),
  CHECK ((claim_id IS NULL) = (lease_until IS NULL)),
  CHECK (claim_id IS NULL OR claim_id=original_claim_id),
  CHECK ((operation_id IS NULL) = (operation_state IS NULL)),
  CHECK ((state='verified') = (submission_state='verified_published')),
  CHECK ((state='not_published') = (submission_state='verified_not_published')),
  CHECK ((state IN ('verified','not_published')) = (verified_result_id IS NOT NULL AND verified_at IS NOT NULL)),
  CHECK (state NOT IN ('running','submission_unknown','verified','not_published') OR operation_id IS NOT NULL)
);
CREATE INDEX business_plan_workflow_claimable ON socialgrowth_product.business_plan_workflow_jobs(state,lease_until,updated_at);

-- Append-only dedup journal stores only event identity and digest, never raw
-- provider payloads, credentials, content, or evidence blobs.
CREATE TABLE socialgrowth_product.business_plan_workflow_events (
  event_id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES socialgrowth_product.business_plan_workflow_jobs(workflow_id),
  event_key text NOT NULL CHECK (length(event_key) BETWEEN 16 AND 200),
  event_type text NOT NULL CHECK (event_type IN ('materialized','blocked','claimed','claim_expired','operation_started','observation_received','verification_completed','recheck_linked')),
  scope_fingerprint bytea NOT NULL CHECK (octet_length(scope_fingerprint)=32),
  payload_digest bytea NOT NULL CHECK (octet_length(payload_digest)=32),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workflow_id,event_key)
);
CREATE FUNCTION socialgrowth_product.business_plan_workflow_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Business plan workflow events are immutable'; END $$;
CREATE TRIGGER business_plan_workflow_event_immutable
  BEFORE UPDATE OR DELETE ON socialgrowth_product.business_plan_workflow_events
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.business_plan_workflow_event_immutable();

COMMIT;
