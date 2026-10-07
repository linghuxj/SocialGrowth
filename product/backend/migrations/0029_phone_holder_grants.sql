BEGIN;
ALTER TABLE socialgrowth_product.phone_control_commands
  DROP CONSTRAINT phone_control_commands_kind_check;
ALTER TABLE socialgrowth_product.phone_control_commands ADD CONSTRAINT phone_control_commands_kind_check
  CHECK (kind IN ('initialize','acquire_holder','begin_call','request_stop','call_result','confirm_stopped'));

-- An internal grant is immutable and globally unique by holder. It is not a
-- device action permit, an HTTP authority source, or evidence of physical stop.
CREATE TABLE socialgrowth_product.phone_control_holder_grants (
  holder_id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES socialgrowth_product.phone_control_journals(device_id),
  control_generation text NOT NULL CHECK(control_generation ~ '^[1-9][0-9]{0,18}$'),
  granted_version bigint NOT NULL CHECK(granted_version BETWEEN 1 AND 9007199254740991),
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  record jsonb NOT NULL,
  CHECK ((jsonb_typeof(record)='object') IS TRUE),
  CHECK ((record->>'holderId'=holder_id::text) IS TRUE),
  CHECK ((record->>'deviceId'=device_id::text) IS TRUE),
  CHECK ((record->>'controlGeneration'=control_generation) IS TRUE)
);
CREATE FUNCTION socialgrowth_product.reject_phone_holder_change() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'phone holder history is immutable'; END $$;
CREATE TRIGGER phone_holder_history BEFORE UPDATE OR DELETE
  ON socialgrowth_product.phone_control_holder_grants
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_phone_holder_change();
COMMIT;
