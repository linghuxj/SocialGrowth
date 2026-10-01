BEGIN;
-- Pending references ONLY, not admitted tasks, content quota or phone permits.
CREATE TABLE socialgrowth_product.task_recheck_guard(singleton boolean PRIMARY KEY CHECK(singleton));
INSERT INTO socialgrowth_product.task_recheck_guard VALUES(true);
CREATE TABLE socialgrowth_product.task_recheck_records(
  task_id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  current_revision bigint NOT NULL CHECK(current_revision BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'pending_current_checks' CHECK(status='pending_current_checks'),
  execution_allowed boolean NOT NULL DEFAULT false CHECK(NOT execution_allowed),
  UNIQUE(task_id,project_id)
);
CREATE TABLE socialgrowth_product.task_recheck_revisions(
  task_id uuid NOT NULL REFERENCES socialgrowth_product.task_recheck_records(task_id),
  revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 1000), contract jsonb NOT NULL CHECK(jsonb_typeof(contract)='object'),
  notice jsonb NOT NULL CHECK(jsonb_typeof(notice)='object'), message_id uuid NOT NULL UNIQUE,
  recorded_by_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id), recorded_at text NOT NULL,
  PRIMARY KEY(task_id,revision), UNIQUE(task_id,revision,message_id),
  CHECK((contract->>'taskId'=task_id::text AND contract->>'taskRevision'=revision::text AND notice->>'taskId'=task_id::text
    AND notice->>'taskRevision'=revision::text AND notice->>'messageId'=message_id::text AND notice->>'executionAllowed'='false') IS TRUE)
);
ALTER TABLE socialgrowth_product.task_recheck_records ADD CONSTRAINT task_recheck_current_fk
  FOREIGN KEY(task_id,current_revision) REFERENCES socialgrowth_product.task_recheck_revisions(task_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE socialgrowth_product.task_recheck_outbox(
  message_id uuid PRIMARY KEY, task_id uuid NOT NULL, revision bigint NOT NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(), delivery_token uuid, attempts bigint NOT NULL DEFAULT 0 CHECK(attempts>=0), queue_observed_at timestamptz,
  FOREIGN KEY(task_id,revision,message_id) REFERENCES socialgrowth_product.task_recheck_revisions(task_id,revision,message_id)
);
CREATE TABLE socialgrowth_product.task_recheck_commands(
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id), request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32), task_id uuid NOT NULL REFERENCES socialgrowth_product.task_recheck_records(task_id),
  PRIMARY KEY(actor_id,request_key)
);
CREATE FUNCTION socialgrowth_product.task_recheck_advance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.task_id,NEW.project_id,NEW.status,NEW.execution_allowed) IS DISTINCT FROM (OLD.task_id,OLD.project_id,OLD.status,OLD.execution_allowed)
    OR NEW.current_revision<>OLD.current_revision+1 THEN RAISE EXCEPTION 'Pending task reference cannot rebind or skip revision'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER task_recheck_record_advance BEFORE UPDATE ON socialgrowth_product.task_recheck_records FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.task_recheck_advance();
CREATE TRIGGER task_recheck_revision_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.task_recheck_revisions FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.material_reject_change();
CREATE FUNCTION socialgrowth_product.task_recheck_outbox_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.message_id,NEW.task_id,NEW.revision) IS DISTINCT FROM (OLD.message_id,OLD.task_id,OLD.revision) OR NEW.attempts<OLD.attempts THEN RAISE EXCEPTION 'Outbox identity cannot change'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER task_recheck_outbox_identity BEFORE UPDATE ON socialgrowth_product.task_recheck_outbox FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.task_recheck_outbox_identity();
COMMIT;
