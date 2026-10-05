-- Reuse current test resources only before any attempt has been dispatched.
-- Executing/unknown operations retain their immutable original assignments.
CREATE OR REPLACE FUNCTION socialgrowth_product.guard_media_account_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND NEW.project_id IS DISTINCT FROM OLD.project_id
    AND (to_jsonb(NEW)-'project_id')=(to_jsonb(OLD)-'project_id')
    AND NOT OLD.handover_requested
    AND EXISTS(SELECT 1 FROM socialgrowth_product.projects WHERE project_id=OLD.project_id AND phase='preparing')
    AND EXISTS(SELECT 1 FROM socialgrowth_product.projects WHERE project_id=NEW.project_id AND phase='preparing')
    AND NOT EXISTS(SELECT 1 FROM socialgrowth_product.business_plan_task_attempts WHERE project_id=OLD.project_id)
    AND NOT EXISTS(SELECT 1 FROM socialgrowth_product.artemis_preparation_intents a
      JOIN socialgrowth_product.account_preparation_tasks t USING(task_id) WHERE t.project_id=OLD.project_id)
  THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Account assignment cannot be released without trusted handover facts'; END IF;
  IF NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.platform IS DISTINCT FROM OLD.platform
    OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.device_id IS DISTINCT FROM OLD.device_id
    OR NEW.state IS DISTINCT FROM OLD.state OR NEW.reserved_by_operator_id IS DISTINCT FROM OLD.reserved_by_operator_id
    OR NEW.reserved_at IS DISTINCT FROM OLD.reserved_at
    OR (OLD.handover_requested AND NEW.handover_requested IS DISTINCT FROM OLD.handover_requested) THEN
    RAISE EXCEPTION 'Account assignment is immutable except for undispatched preparation reuse';
  END IF;
  RETURN NEW;
END $$;
