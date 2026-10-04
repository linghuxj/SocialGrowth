BEGIN;

CREATE TABLE socialgrowth_product.project_review_cycle_configs (
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  configuration_revision bigint NOT NULL CHECK(configuration_revision BETWEEN 1 AND 9007199254740991),
  based_on_cycle_id uuid NOT NULL REFERENCES socialgrowth_product.project_review_cycles(cycle_id),
  business_time_zone text NOT NULL CHECK(length(business_time_zone) BETWEEN 1 AND 64),
  review_interval_days integer NOT NULL CHECK(review_interval_days BETWEEN 1 AND 366),
  traffic_minimum_per_cycle integer NOT NULL CHECK(traffic_minimum_per_cycle >= 0),
  effective_starts_at text NOT NULL CHECK(effective_starts_at !~ '^0000-'),
  projected_ends_at text NOT NULL CHECK(projected_ends_at !~ '^0000-'),
  confirmed_by_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  confirmed_at timestamptz NOT NULL,
  request_id text NOT NULL CHECK(length(request_id) BETWEEN 8 AND 128),
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(project_id,configuration_revision),
  CHECK(effective_starts_at < projected_ends_at)
);

CREATE INDEX project_review_cycle_configs_latest ON socialgrowth_product.project_review_cycle_configs(project_id,configuration_revision DESC);

CREATE TABLE socialgrowth_product.project_review_cycle_config_commands (
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,request_key)
);

CREATE FUNCTION socialgrowth_product.reject_project_review_cycle_config_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Confirmed project review-cycle configuration facts are immutable'; END $$;
CREATE TRIGGER project_review_cycle_config_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.project_review_cycle_configs
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_project_review_cycle_config_change();
CREATE TRIGGER project_review_cycle_config_command_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.project_review_cycle_config_commands
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_project_review_cycle_config_change();

COMMIT;
