BEGIN;
CREATE TABLE socialgrowth_product.local_participation_runs (
  run_id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES socialgrowth_product.devices(device_id),
  installation_id uuid NOT NULL REFERENCES socialgrowth_product.installations(installation_id),
  association_id uuid NOT NULL REFERENCES socialgrowth_product.device_associations(association_id),
  session_id uuid NOT NULL REFERENCES socialgrowth_product.installation_sessions(session_id),
  installation_generation text NOT NULL CHECK(installation_generation ~ '^[1-9][0-9]{0,18}$'),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  record jsonb NOT NULL,
  withdrawal jsonb,
  CHECK(jsonb_typeof(record)='object'),
  CHECK(revoked_at IS NULL OR revoked_at>=started_at),
  CHECK(withdrawal IS NULL OR (revoked_at IS NOT NULL AND jsonb_typeof(withdrawal)='object'))
);
CREATE UNIQUE INDEX local_participation_one_run ON socialgrowth_product.local_participation_runs(device_id) WHERE revoked_at IS NULL;
-- Bounded current challenge/pulse per device, not a phone action permit or a
-- growing every-five-second history. Grant/stop audits remain separate.
CREATE TABLE socialgrowth_product.local_participation (
  device_id uuid PRIMARY KEY REFERENCES socialgrowth_product.devices(device_id),
  sequence text NOT NULL CHECK(sequence ~ '^[1-9][0-9]{0,18}$'),
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  command_kind text NOT NULL CHECK(command_kind IN ('challenge','withdraw')),
  session_id uuid NOT NULL REFERENCES socialgrowth_product.installation_sessions(session_id),
  challenge jsonb,
  receipt jsonb,
  receipt_session_id uuid REFERENCES socialgrowth_product.installation_sessions(session_id),
  stop_request_id uuid,
  CHECK(challenge IS NULL OR jsonb_typeof(challenge)='object'),
  CHECK(receipt IS NULL OR jsonb_typeof(receipt)='object'),
  CHECK((receipt IS NULL)=(receipt_session_id IS NULL)),
  CHECK((command_kind='withdraw')=(stop_request_id IS NOT NULL))
);
COMMIT;
