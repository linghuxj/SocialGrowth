BEGIN;

-- The plan outbox is a non-executable current-check reference. Keep its
-- original row and append mutation-origin facts in a child relation.
ALTER TABLE socialgrowth_product.business_plan_outbox
  ADD COLUMN current_impact_revision bigint NOT NULL DEFAULT 0
    CHECK(current_impact_revision BETWEEN 0 AND 9007199254740991);

CREATE TABLE socialgrowth_product.business_plan_outbox_impacts(
  task_id uuid NOT NULL REFERENCES socialgrowth_product.business_plan_outbox(task_id),
  impact_revision bigint NOT NULL CHECK(impact_revision BETWEEN 1 AND 9007199254740991),
  reason text NOT NULL CHECK(reason IN ('project_scope_changed','material_revision_changed')),
  source_version bigint NOT NULL CHECK(source_version BETWEEN 1 AND 9007199254740991),
  observed_project_version bigint NOT NULL CHECK(observed_project_version BETWEEN 1 AND 9007199254740991),
  observed_material_revision bigint CHECK(observed_material_revision BETWEEN 1 AND 1000),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(task_id,impact_revision),
  UNIQUE(task_id,reason,source_version),
  CHECK((reason='project_scope_changed' AND observed_material_revision IS NULL AND source_version=observed_project_version)
    OR (reason='material_revision_changed' AND observed_material_revision IS NOT NULL AND source_version=observed_material_revision))
);

CREATE FUNCTION socialgrowth_product.business_plan_impact_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Business plan impact references are immutable';
END $$;
CREATE TRIGGER business_plan_impact_immutable
  BEFORE UPDATE OR DELETE ON socialgrowth_product.business_plan_outbox_impacts
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.business_plan_impact_append_only();

CREATE FUNCTION socialgrowth_product.business_plan_impact_matches_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM socialgrowth_product.business_plan_outbox o
    WHERE o.task_id=NEW.task_id AND o.current_impact_revision=NEW.impact_revision
      AND o.purpose='current_check_reference' AND o.state='pending_current_checks'
      AND NOT o.execution_allowed AND NOT o.publication_allowed) THEN
    RAISE EXCEPTION 'Impact reference must match the current non-executable reference head';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER business_plan_impact_matches_head
  BEFORE INSERT ON socialgrowth_product.business_plan_outbox_impacts
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.business_plan_impact_matches_head();

CREATE FUNCTION socialgrowth_product.business_plan_outbox_impact_advance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.message_id,NEW.project_id,NEW.task_id,NEW.purpose,NEW.state,NEW.execution_allowed,NEW.publication_allowed,NEW.recorded_at)
    IS DISTINCT FROM
     (OLD.message_id,OLD.project_id,OLD.task_id,OLD.purpose,OLD.state,OLD.execution_allowed,OLD.publication_allowed,OLD.recorded_at)
    OR NEW.current_impact_revision<>OLD.current_impact_revision+1 THEN
    RAISE EXCEPTION 'Only a single impact-reference revision may advance';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER business_plan_outbox_impact_advance
  BEFORE UPDATE ON socialgrowth_product.business_plan_outbox
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.business_plan_outbox_impact_advance();

COMMIT;
