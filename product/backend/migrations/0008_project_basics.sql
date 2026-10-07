BEGIN;
CREATE TABLE socialgrowth_product.projects (
  project_id uuid PRIMARY KEY,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 150 AND name=btrim(name)),
  kind text NOT NULL CHECK(kind IN ('company_owned','client_managed')),
  customer_name text CHECK(length(customer_name) BETWEEN 1 AND 150 AND customer_name=btrim(customer_name)),
  owner_operator_id uuid REFERENCES socialgrowth_product.operators(operator_id),
  notification_email text,
  phase text NOT NULL DEFAULT 'preparing' CHECK(phase='preparing'),
  fact_version bigint NOT NULL DEFAULT 0 CHECK(fact_version BETWEEN 0 AND 9007199254740991),
  created_by_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(updated_at>=created_at),
  CHECK((kind='client_managed')=(customer_name IS NOT NULL))
);
CREATE TABLE socialgrowth_product.project_metadata_commands (
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  kind text NOT NULL CHECK(kind IN ('create','update')),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  PRIMARY KEY(actor_id,request_key)
);
-- Metadata alone cannot produce approvals, task/phone assignments or execution.
COMMIT;
