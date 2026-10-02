BEGIN;
CREATE TABLE socialgrowth_product.artemis_preparation_intents (
  task_attempt_id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES socialgrowth_product.account_preparation_tasks(task_id),
  task_version bigint NOT NULL CHECK(task_version BETWEEN 0 AND 9007199254740991),
  operation_id text NOT NULL,
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  assignment jsonb NOT NULL CHECK(jsonb_typeof(assignment)='object'),
  trace_id uuid UNIQUE,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(), bound_at timestamptz,
  UNIQUE(task_id,task_version,operation_id),
  CHECK((assignment->>'taskAttemptId') IS NOT DISTINCT FROM task_attempt_id::text),
  CHECK((assignment->>'taskId') IS NOT DISTINCT FROM task_id::text),
  CHECK(((assignment->>'taskVersion')::bigint IS NOT DISTINCT FROM task_version)),
  CHECK((assignment->>'operationId') IS NOT DISTINCT FROM operation_id),
  CHECK((trace_id IS NULL)=(bound_at IS NULL))
);
CREATE TABLE socialgrowth_product.artemis_preparation_observations (
  observation_id uuid PRIMARY KEY,
  task_attempt_id uuid NOT NULL REFERENCES socialgrowth_product.artemis_preparation_intents(task_attempt_id),
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  record jsonb NOT NULL CHECK(jsonb_typeof(record)='object'),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((record->'identityVerified') IS NOT DISTINCT FROM 'false'::jsonb),
  CHECK((record->'publicationAllowed') IS NOT DISTINCT FROM 'false'::jsonb)
);
CREATE FUNCTION socialgrowth_product.guard_preparation_launch_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.task_attempt_id IS DISTINCT FROM OLD.task_attempt_id OR NEW.task_id IS DISTINCT FROM OLD.task_id
    OR NEW.task_version IS DISTINCT FROM OLD.task_version OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint OR NEW.assignment IS DISTINCT FROM OLD.assignment
    OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
    OR (OLD.trace_id IS NOT NULL AND (NEW.trace_id IS DISTINCT FROM OLD.trace_id OR NEW.bound_at IS DISTINCT FROM OLD.bound_at))
  THEN RAISE EXCEPTION 'Preparation launch intent is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preparation_launch_history BEFORE UPDATE OR DELETE ON socialgrowth_product.artemis_preparation_intents
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_preparation_launch_history();
CREATE TRIGGER preparation_observation_history BEFORE UPDATE OR DELETE ON socialgrowth_product.artemis_preparation_observations
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_direction_history_change();
COMMIT;
