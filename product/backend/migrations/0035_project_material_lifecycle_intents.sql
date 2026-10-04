BEGIN;

-- Append-only operator intent and internal withdrawal facts. These records do
-- not modify project phase, material history, task rows, permissions or quota.
CREATE TABLE socialgrowth_product.project_lifecycle_intents(
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  intent text NOT NULL CHECK(intent IN ('pause_requested','resume_requested','end_requested')),
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_id text NOT NULL CHECK(length(request_id) BETWEEN 8 AND 128),
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(project_id,revision),
  UNIQUE(actor_id,request_key),
  UNIQUE(project_id,request_id)
);

CREATE TABLE socialgrowth_product.material_withdrawal_intents(
  variant_id uuid PRIMARY KEY REFERENCES socialgrowth_product.material_variants(variant_id),
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  material_revision bigint NOT NULL CHECK(material_revision BETWEEN 1 AND 1000),
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_id text NOT NULL CHECK(length(request_id) BETWEEN 8 AND 128),
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(actor_id,request_key),
  UNIQUE(project_id,request_id),
  FOREIGN KEY(variant_id,material_revision) REFERENCES socialgrowth_product.material_variant_revisions(variant_id,revision)
);

CREATE TABLE socialgrowth_product.business_plan_task_cancellations(
  task_id uuid PRIMARY KEY REFERENCES socialgrowth_product.business_plan_tasks(task_id),
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  reason text NOT NULL CHECK(reason IN ('project_end','material_withdrawal')),
  source_request_id text NOT NULL CHECK(length(source_request_id) BETWEEN 8 AND 128),
  source_revision bigint NOT NULL CHECK(source_revision BETWEEN 1 AND 9007199254740991),
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(project_id,task_id) REFERENCES socialgrowth_product.business_plan_tasks(project_id,task_id)
);

-- The existing outbox impact table remains the one historical read model.
ALTER TABLE socialgrowth_product.business_plan_outbox_impacts
  DROP CONSTRAINT business_plan_outbox_impacts_reason_check,
  DROP CONSTRAINT business_plan_outbox_impacts_check,
  ADD CONSTRAINT business_plan_outbox_impacts_reason_check
    CHECK(reason IN ('project_scope_changed','material_revision_changed','project_lifecycle_intent_changed','material_withdrawn')),
  ADD CONSTRAINT business_plan_outbox_impacts_source_check CHECK(
    (reason='project_scope_changed' AND observed_material_revision IS NULL AND source_version=observed_project_version)
    OR (reason='material_revision_changed' AND observed_material_revision IS NOT NULL AND source_version=observed_material_revision)
    OR (reason='project_lifecycle_intent_changed' AND observed_material_revision IS NULL)
    OR (reason='material_withdrawn' AND observed_material_revision IS NOT NULL AND source_version=observed_material_revision)
  );

CREATE FUNCTION socialgrowth_product.lifecycle_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Lifecycle history is immutable'; END $$;
CREATE TRIGGER project_lifecycle_intent_immutable
  BEFORE UPDATE OR DELETE ON socialgrowth_product.project_lifecycle_intents
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.lifecycle_history_immutable();
CREATE TRIGGER material_withdrawal_intent_immutable
  BEFORE UPDATE OR DELETE ON socialgrowth_product.material_withdrawal_intents
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.lifecycle_history_immutable();
CREATE TRIGGER business_plan_task_cancellation_immutable
  BEFORE UPDATE OR DELETE ON socialgrowth_product.business_plan_task_cancellations
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.lifecycle_history_immutable();

CREATE FUNCTION socialgrowth_product.business_plan_task_cancellation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM socialgrowth_product.business_plan_tasks t JOIN socialgrowth_product.business_plan_outbox o USING(project_id,task_id)
    WHERE t.task_id=NEW.task_id AND t.project_id=NEW.project_id AND t.state='pending_current_checks'
      AND NOT t.execution_allowed AND NOT t.publication_allowed AND o.purpose='current_check_reference'
      AND o.state='pending_current_checks' AND NOT o.execution_allowed AND NOT o.publication_allowed)
    OR EXISTS(SELECT 1 FROM socialgrowth_product.business_plan_task_attempts a WHERE a.task_id=NEW.task_id) THEN
    RAISE EXCEPTION 'Only an authoritatively never-started task may receive a cancellation fact';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER business_plan_task_cancellation_requires_never_started
  BEFORE INSERT ON socialgrowth_product.business_plan_task_cancellations
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.business_plan_task_cancellation_guard();

COMMIT;
