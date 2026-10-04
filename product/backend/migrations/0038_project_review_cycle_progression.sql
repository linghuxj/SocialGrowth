BEGIN;

-- Explicitly distinguish the first approved scope source from one-time
-- operator configuration and ordinary carry-forward windows. Existing cycle
-- facts are projected as initial rows without rewriting immutable history.
ALTER TABLE socialgrowth_product.project_review_cycle_configs
  ADD CONSTRAINT project_review_cycle_configs_source_unique
    UNIQUE(project_id,configuration_revision,based_on_cycle_id);

ALTER TABLE socialgrowth_product.project_review_cycles
  ADD CONSTRAINT project_review_cycles_ends_at_utc_check CHECK(ends_at ~ 'Z$'),
  ADD COLUMN origin_kind text NOT NULL DEFAULT 'initial_direction_approval'
    CHECK(origin_kind IN ('initial_direction_approval','confirmed_next_configuration','carry_forward')),
  ADD COLUMN source_configuration_revision bigint,
  ADD COLUMN predecessor_cycle_id uuid,
  ADD COLUMN predecessor_cycle_number bigint,
  ADD COLUMN review_interval_days integer,
  ADD CONSTRAINT project_review_cycles_review_interval_check
    CHECK(review_interval_days IS NULL OR review_interval_days BETWEEN 1 AND 366),
  ADD CONSTRAINT project_review_cycles_origin_shape_check CHECK(
    (origin_kind='initial_direction_approval' AND cycle_number=1
      AND source_configuration_revision IS NULL AND predecessor_cycle_id IS NULL AND predecessor_cycle_number IS NULL)
    OR (origin_kind='confirmed_next_configuration' AND cycle_number>1
      AND source_configuration_revision IS NOT NULL AND predecessor_cycle_id IS NOT NULL AND predecessor_cycle_number IS NOT NULL)
    OR (origin_kind='carry_forward' AND cycle_number>1
      AND source_configuration_revision IS NULL AND predecessor_cycle_id IS NOT NULL AND predecessor_cycle_number IS NOT NULL)
  ),
  ADD CONSTRAINT project_review_cycles_id_number_unique UNIQUE(project_id,cycle_id,cycle_number),
  ADD CONSTRAINT project_review_cycles_predecessor_fk
    FOREIGN KEY(project_id,predecessor_cycle_id,predecessor_cycle_number)
    REFERENCES socialgrowth_product.project_review_cycles(project_id,cycle_id,cycle_number),
  ADD CONSTRAINT project_review_cycles_config_source_fk
    FOREIGN KEY(project_id,source_configuration_revision,predecessor_cycle_id)
    REFERENCES socialgrowth_product.project_review_cycle_configs(project_id,configuration_revision,based_on_cycle_id);

CREATE UNIQUE INDEX project_review_cycles_one_initial_origin
  ON socialgrowth_product.project_review_cycles(project_id)
  WHERE origin_kind='initial_direction_approval';
CREATE UNIQUE INDEX project_review_cycles_consume_config_once
  ON socialgrowth_product.project_review_cycles(project_id,source_configuration_revision)
  WHERE origin_kind='confirmed_next_configuration';
CREATE INDEX project_review_cycles_due_lookup
  ON socialgrowth_product.project_review_cycles(ends_at COLLATE "C",project_id,cycle_number DESC);

CREATE FUNCTION socialgrowth_product.validate_project_review_cycle_origin() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous socialgrowth_product.project_review_cycles%ROWTYPE;
  configuration socialgrowth_product.project_review_cycle_configs%ROWTYPE;
BEGIN
  IF NEW.review_interval_days IS NULL THEN
    RAISE EXCEPTION 'New review cycle requires an explicit interval';
  END IF;

  IF NEW.origin_kind='initial_direction_approval' THEN
    IF NEW.cycle_number<>1 OR NEW.approval_id IS NULL THEN
      RAISE EXCEPTION 'Initial direction approval may source only cycle one';
    END IF;
    RETURN NEW;
  END IF;

  SELECT * INTO previous FROM socialgrowth_product.project_review_cycles
    WHERE project_id=NEW.project_id AND cycle_id=NEW.predecessor_cycle_id FOR KEY SHARE;
  IF NOT FOUND OR previous.cycle_number<>NEW.predecessor_cycle_number
    OR NEW.cycle_number<>previous.cycle_number+1
    OR NEW.starts_at::timestamptz<>previous.ends_at::timestamptz
    OR NEW.approval_id<>previous.approval_id OR NEW.project_version<>previous.project_version
    OR NEW.approved_inputs<>previous.approved_inputs THEN
    RAISE EXCEPTION 'Review cycle must continue the exact preceding window and initial approved scope';
  END IF;

  IF NEW.origin_kind='confirmed_next_configuration' THEN
    SELECT * INTO configuration FROM socialgrowth_product.project_review_cycle_configs
      WHERE project_id=NEW.project_id AND configuration_revision=NEW.source_configuration_revision
        AND based_on_cycle_id=NEW.predecessor_cycle_id;
    IF NOT FOUND OR NEW.config_version<=previous.config_version
      OR NEW.business_time_zone<>configuration.business_time_zone
      OR NEW.review_interval_days<>configuration.review_interval_days
      OR NEW.traffic_minimum<>configuration.traffic_minimum_per_cycle
      OR NEW.starts_at::timestamptz<>configuration.effective_starts_at::timestamptz
      OR NEW.ends_at::timestamptz<>configuration.projected_ends_at::timestamptz THEN
      RAISE EXCEPTION 'Review cycle does not match its unique confirmed configuration';
    END IF;
  ELSE
    IF NEW.config_version<>previous.config_version
      OR NEW.business_time_zone<>previous.business_time_zone
      OR NEW.review_interval_days<>COALESCE(previous.review_interval_days,
        NULLIF(previous.approved_inputs->>'reviewIntervalDays','')::integer)
      OR NEW.traffic_minimum<>previous.traffic_minimum THEN
      RAISE EXCEPTION 'Carried review cycle must preserve the preceding configuration';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER project_review_cycle_origin_insert_guard
  BEFORE INSERT ON socialgrowth_product.project_review_cycles
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.validate_project_review_cycle_origin();

COMMIT;
