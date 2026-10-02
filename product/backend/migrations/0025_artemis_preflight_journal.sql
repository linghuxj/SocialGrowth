BEGIN;
-- Durable advisory preflight intents only. No action permission, executable
-- task producer, queue consumer or verified publication state is created here.
CREATE TABLE socialgrowth_product.artemis_preflight_intents (
  task_attempt_id uuid PRIMARY KEY,
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  assignment jsonb NOT NULL CHECK(jsonb_typeof(assignment)='object'),
  trace_id uuid UNIQUE,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  bound_at timestamptz,
  CHECK((assignment->'task'->>'taskAttemptId') IS NOT DISTINCT FROM task_attempt_id::text),
  CHECK((trace_id IS NULL)=(bound_at IS NULL))
);
CREATE TABLE socialgrowth_product.artemis_preflight_observations (
  observation_id uuid PRIMARY KEY,
  task_attempt_id uuid NOT NULL REFERENCES socialgrowth_product.artemis_preflight_intents(task_attempt_id),
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
  record jsonb NOT NULL CHECK(jsonb_typeof(record)='object'),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((record->>'publicationState') IS NOT DISTINCT FROM 'unverified'),
  CHECK((record->'publicationAllowed') IS NOT DISTINCT FROM 'false'::jsonb)
);
CREATE FUNCTION socialgrowth_product.guard_preflight_intent_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Preflight intent cannot be deleted'; END IF;
  IF NEW.task_attempt_id IS DISTINCT FROM OLD.task_attempt_id OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
    OR NEW.assignment IS DISTINCT FROM OLD.assignment OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
    OR (OLD.trace_id IS NOT NULL AND (NEW.trace_id IS DISTINCT FROM OLD.trace_id OR NEW.bound_at IS DISTINCT FROM OLD.bound_at))
    THEN RAISE EXCEPTION 'Preflight intent binding is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER preflight_intent_history BEFORE UPDATE OR DELETE ON socialgrowth_product.artemis_preflight_intents FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_preflight_intent_history();
CREATE TRIGGER preflight_observation_history BEFORE UPDATE OR DELETE ON socialgrowth_product.artemis_preflight_observations FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_direction_history_change();
COMMIT;
