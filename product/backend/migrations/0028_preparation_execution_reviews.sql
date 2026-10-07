BEGIN;
-- Operator-triggered immutable checks, never an executable queue/permit.
CREATE TABLE socialgrowth_product.account_preparation_execution_reviews (
  review_id uuid PRIMARY KEY,
  review_sequence bigint GENERATED ALWAYS AS IDENTITY,
  task_id uuid NOT NULL REFERENCES socialgrowth_product.account_preparation_tasks(task_id),
  task_version bigint NOT NULL CHECK(task_version BETWEEN 0 AND 9007199254740991),
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  record jsonb NOT NULL CHECK(jsonb_typeof(record)='object'),
  UNIQUE(actor_id,request_key),
  CHECK((record->>'reviewId') IS NOT DISTINCT FROM review_id::text),
  CHECK((record->>'taskId') IS NOT DISTINCT FROM task_id::text),
  CHECK(((record->>'taskVersion')::bigint IS NOT DISTINCT FROM task_version)),
  CHECK((record->>'reviewedBy') IS NOT DISTINCT FROM actor_id::text),
  CHECK((record->>'state') IS NOT DISTINCT FROM 'blocked'),
  CHECK((record->'dispatchCreated') IS NOT DISTINCT FROM 'false'::jsonb),
  CHECK((record->'actionPermissionGranted') IS NOT DISTINCT FROM 'false'::jsonb),
  CHECK((record->'publicationAllowed') IS NOT DISTINCT FROM 'false'::jsonb)
);
CREATE INDEX account_preparation_execution_reviews_task_idx
  ON socialgrowth_product.account_preparation_execution_reviews(task_id,review_sequence DESC);
CREATE TRIGGER preparation_execution_review_history BEFORE UPDATE OR DELETE
  ON socialgrowth_product.account_preparation_execution_reviews
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_direction_history_change();
COMMIT;
