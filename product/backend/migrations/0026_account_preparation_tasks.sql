BEGIN;
-- Central preparation requests, not an executable queue or a readiness grant.
CREATE TABLE socialgrowth_product.account_preparation_tasks (
  task_id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  parent_login_ref text NOT NULL CHECK(parent_login_ref ~ '^[A-Za-z0-9_-]{1,150}$'),
  platform text NOT NULL CHECK(platform IN ('facebook','youtube')),
  intent jsonb NOT NULL CHECK(jsonb_typeof(intent)='object'),
  intent_digest text NOT NULL CHECK(intent_digest ~ '^[a-f0-9]{64}$'),
  selected_account_id uuid REFERENCES socialgrowth_product.media_accounts(account_id),
  selected_device_id uuid REFERENCES socialgrowth_product.devices(device_id),
  task_version bigint NOT NULL DEFAULT 0 CHECK(task_version BETWEEN 0 AND 9007199254740991),
  state text NOT NULL CHECK(state IN ('waiting_resources','waiting_executor','needs_reconciliation')),
  next_operation_id text,
  blockers jsonb NOT NULL CHECK(jsonb_typeof(blockers)='array'),
  requested_by uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(project_id,parent_login_ref,platform),
  CHECK((intent->>'parentLoginRef') IS NOT DISTINCT FROM parent_login_ref),
  CHECK((selected_account_id IS NULL)=(selected_device_id IS NULL)),
  CHECK((intent->'target'->>'platform') IS NOT DISTINCT FROM platform)
);
CREATE TABLE socialgrowth_product.account_preparation_commands (
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
  task_id uuid NOT NULL REFERENCES socialgrowth_product.account_preparation_tasks(task_id),
  kind text NOT NULL CHECK(kind IN ('request','recheck')),
  PRIMARY KEY(actor_id,request_key)
);
CREATE TABLE socialgrowth_product.account_preparation_checks (
  check_id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES socialgrowth_product.account_preparation_tasks(task_id),
  task_version bigint NOT NULL CHECK(task_version BETWEEN 0 AND 9007199254740991),
  record jsonb NOT NULL CHECK(jsonb_typeof(record)='object'),
  checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(task_id,task_version),
  CHECK((record->'actionPermissionGranted') IS NOT DISTINCT FROM 'false'::jsonb),
  CHECK((record->>'taskId') IS NOT DISTINCT FROM task_id::text),
  CHECK(((record->>'taskVersion')::bigint IS NOT DISTINCT FROM task_version)),
  CHECK((record->'publicationAllowed') IS NOT DISTINCT FROM 'false'::jsonb),
  CHECK((record->'acceptanceStarted') IS NOT DISTINCT FROM 'false'::jsonb)
);
CREATE FUNCTION socialgrowth_product.guard_account_preparation_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.parent_login_ref IS DISTINCT FROM OLD.parent_login_ref OR NEW.platform IS DISTINCT FROM OLD.platform
    OR NEW.intent IS DISTINCT FROM OLD.intent OR NEW.intent_digest IS DISTINCT FROM OLD.intent_digest
    OR NEW.requested_by IS DISTINCT FROM OLD.requested_by OR NEW.requested_at IS DISTINCT FROM OLD.requested_at
    OR (OLD.selected_account_id IS NOT NULL AND NEW.selected_account_id IS DISTINCT FROM OLD.selected_account_id)
    OR (OLD.selected_device_id IS NOT NULL AND NEW.selected_device_id IS DISTINCT FROM OLD.selected_device_id)
  THEN RAISE EXCEPTION 'Preparation intent is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER account_preparation_intent_history BEFORE UPDATE OR DELETE ON socialgrowth_product.account_preparation_tasks
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_account_preparation_intent();
CREATE TRIGGER account_preparation_command_history BEFORE UPDATE OR DELETE ON socialgrowth_product.account_preparation_commands
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_direction_history_change();
CREATE TRIGGER account_preparation_check_history BEFORE UPDATE OR DELETE ON socialgrowth_product.account_preparation_checks
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_direction_history_change();
COMMIT;
