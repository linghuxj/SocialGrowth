BEGIN;

-- One pinned maintenance round per physical device. Epoch/port/process changes
-- cannot allocate a new round. A reviewed re-enrollment/reset is NOT provided.
CREATE TABLE socialgrowth_product.connection_maintenance_rounds (
  device_id uuid PRIMARY KEY REFERENCES socialgrowth_product.devices(device_id),
  installation_id uuid NOT NULL,
  enrollment_id uuid NOT NULL,
  round_id uuid NOT NULL UNIQUE,
  version bigint NOT NULL CHECK(version BETWEEN 0 AND 9007199254740991),
  phase text NOT NULL CHECK(phase IN ('available','recovering','human_required')),
  record jsonb NOT NULL,
  FOREIGN KEY(enrollment_id,installation_id,device_id)
    REFERENCES socialgrowth_product.network_enrollments(enrollment_id,installation_id,device_id),
  CHECK((jsonb_typeof(record)='object') IS TRUE),
  CHECK((record->'scope'->>'deviceId'=device_id::text) IS TRUE),
  CHECK((record->'scope'->>'installationId'=installation_id::text) IS TRUE),
  CHECK((record->'scope'->>'enrollmentId'=enrollment_id::text) IS TRUE),
  CHECK((record->'scope'->>'roundId'=round_id::text) IS TRUE),
  CHECK(((record->>'version')::bigint=version) IS TRUE),
  CHECK((record->>'phase'=phase) IS TRUE),
  CHECK((jsonb_typeof(record->'attempts')='array') IS TRUE)
);
CREATE TABLE socialgrowth_product.connection_maintenance_commands (
  device_id uuid NOT NULL REFERENCES socialgrowth_product.connection_maintenance_rounds(device_id),
  request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  expected_version bigint NOT NULL CHECK(expected_version BETWEEN 0 AND 9007199254740991),
  kind text NOT NULL CHECK(kind IN ('initialize','begin','observe','complete','require_human','observe_joint')),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  applied_version bigint NOT NULL CHECK(applied_version BETWEEN 0 AND 9007199254740991),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(device_id,request_key)
);
CREATE FUNCTION socialgrowth_product.guard_connection_maintenance_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_attempt jsonb; new_attempt jsonb; n integer;
BEGIN
  IF NEW.device_id<>OLD.device_id OR NEW.installation_id<>OLD.installation_id OR NEW.enrollment_id<>OLD.enrollment_id
    OR NEW.round_id<>OLD.round_id OR NEW.version<OLD.version
    OR NEW.record->'scope' IS DISTINCT FROM OLD.record->'scope'
    OR NEW.record->'limits' IS DISTINCT FROM OLD.record->'limits'
    OR NEW.record->'createdAt' IS DISTINCT FROM OLD.record->'createdAt'
    OR (NEW.record->>'observedAt')::timestamptz<(OLD.record->>'observedAt')::timestamptz
    OR (NEW.record->>'elapsedMs')::bigint<(OLD.record->>'elapsedMs')::bigint
    OR jsonb_array_length(NEW.record->'attempts')<jsonb_array_length(OLD.record->'attempts')
    OR (OLD.phase='human_required' AND NEW.phase<>'human_required') THEN
    RAISE EXCEPTION 'Maintenance history cannot reset';
  END IF;
  FOR old_attempt,n IN SELECT v,(ordinality-1)::integer FROM jsonb_array_elements(OLD.record->'attempts') WITH ORDINALITY x(v,ordinality) LOOP
    new_attempt:=NEW.record->'attempts'->n;
    IF old_attempt->'endedAt'<>'null'::jsonb THEN
      IF new_attempt IS DISTINCT FROM old_attempt THEN RAISE EXCEPTION 'Closed maintenance receipt is immutable'; END IF;
    ELSIF (new_attempt-'accountedAt'-'endedAt'-'outcome') IS DISTINCT FROM (old_attempt-'accountedAt'-'endedAt'-'outcome')
      OR (new_attempt->>'accountedAt')::timestamptz<(old_attempt->>'accountedAt')::timestamptz
      OR (old_attempt->>'outcome'='unknown' AND new_attempt->>'outcome'='running') THEN
      RAISE EXCEPTION 'Maintenance call identity is immutable';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER connection_maintenance_history_immutable BEFORE UPDATE ON socialgrowth_product.connection_maintenance_rounds
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_connection_maintenance_history();
CREATE FUNCTION socialgrowth_product.guard_connection_maintenance_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Maintenance command is immutable'; END $$;
CREATE TRIGGER connection_maintenance_command_immutable BEFORE UPDATE ON socialgrowth_product.connection_maintenance_commands
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_connection_maintenance_command();
-- DELETE/administrative retention and production capacity remain OPS policy.
COMMIT;
