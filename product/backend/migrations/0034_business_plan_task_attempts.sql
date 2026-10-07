BEGIN;
-- A persistent logical reservation record only. This is deliberately not an
-- Artemis command, physical assignment, or source of execution authority.
CREATE TABLE socialgrowth_product.business_plan_task_attempts (
  task_attempt_id uuid PRIMARY KEY,
  task_id uuid NOT NULL UNIQUE,
  project_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  plan_revision bigint NOT NULL CHECK (plan_revision BETWEEN 1 AND 9007199254740991),
  project_version bigint NOT NULL CHECK (project_version BETWEEN 0 AND 9007199254740991),
  approval_id uuid NOT NULL REFERENCES socialgrowth_product.project_direction_approvals(approval_id),
  window_start text NOT NULL CHECK (window_start !~ '^0000-'),
  window_end text NOT NULL CHECK (window_end !~ '^0000-'),
  task_revision bigint NOT NULL CHECK (task_revision BETWEEN 1 AND 1000),
  content_unit_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  material_revision bigint NOT NULL CHECK (material_revision BETWEEN 1 AND 1000),
  verifier_manifest jsonb NOT NULL CHECK (
    jsonb_typeof(verifier_manifest)='array'
    AND jsonb_array_length(verifier_manifest) BETWEEN 1 AND 20
  ),
  identity_id uuid NOT NULL,
  account_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('facebook','youtube')),
  reserved_device_id uuid NOT NULL,
  reservation_state text NOT NULL DEFAULT 'pending_initialization' CHECK (reservation_state='pending_initialization'),
  reservation_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  reservation_recorded_at timestamptz NOT NULL,
  attempt_number smallint NOT NULL DEFAULT 1 CHECK (attempt_number=1),
  assignment_semantics text NOT NULL DEFAULT 'logical_reservation_bound' CHECK (assignment_semantics='logical_reservation_bound'),
  state text NOT NULL DEFAULT 'pending_current_checks' CHECK (state='pending_current_checks'),
  started_at timestamptz,
  execution_allowed boolean NOT NULL DEFAULT false CHECK (NOT execution_allowed),
  publication_allowed boolean NOT NULL DEFAULT false CHECK (NOT publication_allowed),
  recorded_by_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(project_id,task_id) REFERENCES socialgrowth_product.business_plan_tasks(project_id,task_id),
  FOREIGN KEY(project_id,plan_revision,plan_id) REFERENCES socialgrowth_product.business_plan_revisions(project_id,revision,plan_id),
  FOREIGN KEY(variant_id,material_revision) REFERENCES socialgrowth_product.material_variant_revisions(variant_id,revision),
  FOREIGN KEY(identity_id,account_id,platform) REFERENCES socialgrowth_product.publishing_identities(identity_id,account_id,platform),
  FOREIGN KEY(reserved_device_id,project_id) REFERENCES socialgrowth_product.project_device_reservations(device_id,project_id),
  CHECK (started_at IS NULL)
);

CREATE TRIGGER business_plan_task_attempt_immutable
  BEFORE UPDATE OR DELETE ON socialgrowth_product.business_plan_task_attempts
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.business_plan_immutable();
COMMIT;
