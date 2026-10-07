BEGIN;
ALTER TABLE socialgrowth_product.task_recovery_rounds
  ADD CONSTRAINT task_recovery_rounds_device_attempt_unique UNIQUE(task_attempt_id,device_id);
ALTER TABLE socialgrowth_product.connection_maintenance_commands
  DROP CONSTRAINT connection_maintenance_commands_kind_check;
ALTER TABLE socialgrowth_product.connection_maintenance_commands
  ADD CONSTRAINT connection_maintenance_commands_kind_check
  CHECK(kind IN ('initialize','begin','observe','complete','require_human','observe_joint','reserve_joint','complete_joint'));

-- No invented task when there is genuinely none. A task FK proves only a
-- persisted budget, NOT an actual task/holder or execution authorization.
CREATE TABLE socialgrowth_product.joint_recovery_reservations (
  device_id uuid NOT NULL REFERENCES socialgrowth_product.connection_maintenance_rounds(device_id),
  recovery_id uuid NOT NULL,
  maintenance_scope jsonb NOT NULL,
  endpoint_ref jsonb NOT NULL,
  task_attempt_id uuid,
  task_scope jsonb,
  PRIMARY KEY(device_id,recovery_id),
  FOREIGN KEY(task_attempt_id,device_id) REFERENCES socialgrowth_product.task_recovery_rounds(task_attempt_id,device_id),
  CHECK((jsonb_typeof(maintenance_scope)='object') IS TRUE),
  CHECK((maintenance_scope->>'deviceId'=device_id::text) IS TRUE),
  CHECK((jsonb_typeof(endpoint_ref)='object') IS TRUE),
  CHECK((endpoint_ref->>'sequence' ~ '^[1-9][0-9]{0,18}$') IS TRUE),
  CHECK(((endpoint_ref->>'endpointRevision')::bigint BETWEEN 1 AND 9007199254740991) IS TRUE),
  CHECK((task_attempt_id IS NULL)=(task_scope IS NULL)),
  CHECK(task_scope IS NULL OR ((jsonb_typeof(task_scope)='object'
    AND task_scope->>'taskAttemptId'=task_attempt_id::text AND task_scope->>'deviceId'=device_id::text) IS TRUE))
);
CREATE FUNCTION socialgrowth_product.guard_joint_recovery_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Joint recovery reservation is immutable'; END $$;
CREATE TRIGGER joint_recovery_reservation_immutable BEFORE UPDATE ON socialgrowth_product.joint_recovery_reservations
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_joint_recovery_reservation();
-- Administrative DELETE/retention, backfill of prototype history and actual
-- current-task/physical-call adapters remain separate work, not fake success.
COMMIT;
