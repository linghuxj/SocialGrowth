BEGIN;

CREATE TABLE socialgrowth_product.installation_bootstrap_admissions (
  admission_id uuid PRIMARY KEY,
  source_digest bytea NOT NULL,
  installation_id uuid NOT NULL UNIQUE
    REFERENCES socialgrowth_product.installations(installation_id),
  admitted_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE INDEX installation_bootstrap_admissions_source_time_idx
  ON socialgrowth_product.installation_bootstrap_admissions(
    source_digest, admitted_at DESC
  );

CREATE INDEX installation_bootstrap_admissions_time_idx
  ON socialgrowth_product.installation_bootstrap_admissions(admitted_at DESC);

COMMIT;
