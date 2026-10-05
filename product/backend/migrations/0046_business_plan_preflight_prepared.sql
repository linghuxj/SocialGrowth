BEGIN;
ALTER TABLE socialgrowth_product.business_plan_workflow_jobs
  DROP CONSTRAINT business_plan_workflow_jobs_state_check,
  DROP CONSTRAINT business_plan_workflow_jobs_submission_state_check,
  DROP CONSTRAINT business_plan_workflow_jobs_operation_state_check,
  DROP CONSTRAINT business_plan_workflow_jobs_check6,
  DROP CONSTRAINT business_plan_workflow_jobs_check7;
ALTER TABLE socialgrowth_product.business_plan_workflow_jobs
  ADD COLUMN prepared_at timestamptz,
  ADD COLUMN prepared_result_id text CHECK (prepared_result_id IS NULL OR length(prepared_result_id) BETWEEN 1 AND 200),
  ADD CONSTRAINT business_plan_workflow_jobs_state_check CHECK (state IN ('blocked','queued','claimed','running','submission_unknown','prepared','verified','not_published','failed')),
  ADD CONSTRAINT business_plan_workflow_jobs_submission_state_check CHECK (submission_state IN ('not_started','in_progress','unknown','prepared','verified_published','verified_not_published')),
  ADD CONSTRAINT business_plan_workflow_jobs_operation_state_check CHECK (operation_state IS NULL OR operation_state IN ('queued','claimed','running','submission_unknown','prepared','verified','not_published','failed')),
  ADD CONSTRAINT business_plan_workflow_prepared_result CHECK (
    (state='prepared') = (prepared_at IS NOT NULL AND prepared_result_id IS NOT NULL)
    AND ((state IN ('verified','not_published')) = (verified_result_id IS NOT NULL AND verified_at IS NOT NULL))
    AND (state NOT IN ('running','submission_unknown','prepared','verified','not_published') OR operation_id IS NOT NULL)
  );
COMMIT;
