BEGIN;

-- A task/todo edge exists only after a trusted producer supplies the exact
-- immutable attempt and affected device. Global/device-only todos remain
-- unlinked. The recheck projection is mutable; it is never execution authority.
CREATE TABLE socialgrowth_product.task_assistance_recheck_links (
  task_attempt_id uuid PRIMARY KEY REFERENCES socialgrowth_product.business_plan_task_attempts(task_attempt_id),
  task_id uuid NOT NULL REFERENCES socialgrowth_product.business_plan_tasks(task_id),
  todo_id uuid NOT NULL UNIQUE REFERENCES socialgrowth_product.device_assistance_todos(todo_id),
  device_id uuid NOT NULL REFERENCES socialgrowth_product.devices(device_id),
  status text NOT NULL DEFAULT 'not_requested'
    CHECK(status IN ('not_requested','pending','claimed','verified_recovered','still_blocked','unknown')),
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK(jsonb_typeof(blockers)='array' AND jsonb_array_length(blockers)<=32),
  version bigint NOT NULL DEFAULT 0 CHECK(version BETWEEN 0 AND 9007199254740991),
  last_reported_note_id uuid REFERENCES socialgrowth_product.device_assistance_notes(note_id),
  checked_at timestamptz,
  claim_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((status='claimed' OR (status='unknown' AND claim_token IS NOT NULL))=(claim_token IS NOT NULL AND lease_until IS NOT NULL)),
  -- Expiry is allowed after creation; the consumer reconciles expired claims read-only.
  CHECK(lease_until IS NULL OR lease_until>created_at),
  CHECK(checked_at IS NULL OR checked_at>=created_at),
  CHECK(updated_at>=created_at)
);

CREATE FUNCTION socialgrowth_product.guard_task_assistance_recheck_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reserved_device uuid;
BEGIN
  SELECT reserved_device_id INTO reserved_device
    FROM socialgrowth_product.business_plan_task_attempts
    WHERE task_attempt_id=NEW.task_attempt_id AND task_id=NEW.task_id;
  IF reserved_device IS NULL OR reserved_device<>NEW.device_id OR NOT EXISTS (
    SELECT 1 FROM socialgrowth_product.device_assistance_impacts i
    WHERE i.todo_id=NEW.todo_id AND i.device_id=NEW.device_id
  ) THEN RAISE EXCEPTION 'Task assistance link must match the exact reserved attempt and recorded impact'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER task_assistance_recheck_link_exact
  BEFORE INSERT OR UPDATE OF task_attempt_id,task_id,todo_id,device_id
  ON socialgrowth_product.task_assistance_recheck_links
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_task_assistance_recheck_link();

CREATE FUNCTION socialgrowth_product.guard_task_assistance_recheck_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Task assistance link identity is immutable'; END $$;
CREATE TRIGGER task_assistance_recheck_identity_immutable
  BEFORE DELETE OR UPDATE OF task_attempt_id,task_id,todo_id,device_id,created_at
  ON socialgrowth_product.task_assistance_recheck_links
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_task_assistance_recheck_identity();

CREATE INDEX task_assistance_recheck_pending_idx
  ON socialgrowth_product.task_assistance_recheck_links(updated_at,task_attempt_id)
  WHERE status='pending';
COMMIT;
