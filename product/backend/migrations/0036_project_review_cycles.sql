BEGIN;

CREATE TABLE socialgrowth_product.project_review_cycles (
  cycle_id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  cycle_number bigint NOT NULL CHECK(cycle_number BETWEEN 1 AND 9007199254740991),
  config_version bigint NOT NULL CHECK(config_version BETWEEN 1 AND 9007199254740991),
  approval_id uuid NOT NULL REFERENCES socialgrowth_product.project_direction_approvals(approval_id),
  project_version bigint NOT NULL CHECK(project_version BETWEEN 1 AND 9007199254740991),
  business_time_zone text NOT NULL,
  starts_at text NOT NULL CHECK(starts_at !~ '^0000-'),
  ends_at text NOT NULL CHECK(ends_at !~ '^0000-'),
  traffic_minimum integer NOT NULL CHECK(traffic_minimum >= 0),
  approved_inputs jsonb NOT NULL CHECK(jsonb_typeof(approved_inputs)='object'),
  icu_version text NOT NULL CHECK(length(icu_version) BETWEEN 1 AND 32),
  tzdata_version text NOT NULL CHECK(length(tzdata_version) BETWEEN 1 AND 32),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(project_id,cycle_number),
  CHECK(starts_at < ends_at)
);

CREATE INDEX project_review_cycles_history ON socialgrowth_product.project_review_cycles(project_id,cycle_number);

CREATE FUNCTION socialgrowth_product.reject_project_review_cycle_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Project review-cycle history is immutable'; END $$;
CREATE TRIGGER project_review_cycle_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.project_review_cycles
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_project_review_cycle_change();

COMMIT;
