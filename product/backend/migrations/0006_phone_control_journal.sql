BEGIN;

-- Internal journal only, not a permission endpoint or an executor queue.
CREATE TABLE socialgrowth_product.phone_control_journals (
  device_id uuid PRIMARY KEY REFERENCES socialgrowth_product.devices(device_id),
  version bigint NOT NULL CHECK (version BETWEEN 0 AND 9007199254740991),
  control_generation text NOT NULL CHECK (control_generation ~ '^[1-9][0-9]{0,18}$'),
  disposition text NOT NULL CHECK (disposition IN ('enabled','stop_requested','stopped')),
  holder_id uuid,
  record jsonb NOT NULL,
  CHECK ((jsonb_typeof(record)='object') IS TRUE),
  CHECK ((record->>'deviceId'=device_id::text) IS TRUE),
  CHECK (((record->>'version')::bigint=version) IS TRUE),
  CHECK ((record->>'controlGeneration'=control_generation) IS TRUE),
  CHECK ((record->>'disposition'=disposition) IS TRUE),
  CHECK ((record ? 'holderId') IS TRUE),
  CHECK ((record->>'holderId') IS NOT DISTINCT FROM holder_id::text),
  CHECK ((jsonb_typeof(record->'calls')='array') IS TRUE),
  CHECK (disposition<>'enabled' OR holder_id IS NOT NULL),
  CHECK (disposition='enabled' OR (record->>'stopRequestId') IS NOT NULL),
  CHECK (disposition<>'stopped' OR (holder_id IS NULL AND (record->>'stopEvidenceId') IS NOT NULL))
);

CREATE TABLE socialgrowth_product.phone_control_commands (
  device_id uuid NOT NULL REFERENCES socialgrowth_product.phone_control_journals(device_id),
  request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  expected_version bigint NOT NULL CHECK (expected_version BETWEEN 0 AND 9007199254740991),
  kind text NOT NULL CHECK (kind IN ('initialize','begin_call','request_stop','call_result','confirm_stopped')),
  payload_digest bytea NOT NULL CHECK (octet_length(payload_digest)=32),
  applied_version bigint NOT NULL CHECK (applied_version BETWEEN 0 AND 9007199254740991),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(device_id,request_key)
);

-- No holder acquisition/re-enable, HTTP, external stop worker or automatic
-- lease release in this stage. Unknown calls remain in the persisted record.
COMMIT;
