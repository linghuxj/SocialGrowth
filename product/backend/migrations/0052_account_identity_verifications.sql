BEGIN;
CREATE TABLE socialgrowth_product.account_identity_verifications (
  task_id uuid PRIMARY KEY REFERENCES socialgrowth_product.account_preparation_tasks(task_id),
  source_job_id uuid NOT NULL UNIQUE,
  identity_id uuid NOT NULL REFERENCES socialgrowth_product.publishing_identities(identity_id),
  account_id uuid NOT NULL REFERENCES socialgrowth_product.media_accounts(account_id),
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  device_id uuid NOT NULL REFERENCES socialgrowth_product.devices(device_id),
  platform text NOT NULL CHECK(platform IN ('facebook','youtube')),
  credential_id uuid NOT NULL,
  credential_revision bigint NOT NULL,
  login_identifier text NOT NULL,
  receipt_digest text NOT NULL CHECK(receipt_digest ~ '^[a-f0-9]{64}$'),
  receipt jsonb NOT NULL,
  verified_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(credential_id,account_id,platform,credential_revision)
    REFERENCES socialgrowth_product.media_credential_revisions(credential_id,account_id,platform,revision),
  CHECK(receipt->>'sourceJobId'=source_job_id::text),
  CHECK(receipt->>'requestId'=task_id::text),
  CHECK(receipt->>'accountId'=account_id::text),
  CHECK(receipt->>'projectId'=project_id::text),
  CHECK(receipt->>'deviceId'=device_id::text),
  CHECK(receipt->'noPublication'='true'::jsonb)
);
CREATE TRIGGER account_identity_verification_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.account_identity_verifications
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_direction_history_change();
ALTER TABLE socialgrowth_product.account_preparation_commands DROP CONSTRAINT account_preparation_commands_kind_check;
ALTER TABLE socialgrowth_product.account_preparation_commands ADD CONSTRAINT account_preparation_commands_kind_check
  CHECK(kind IN ('request','recheck','identity-sync'));
COMMIT;
