BEGIN;

-- Task/attempt objects are not yet implemented. Their immutable UUIDs are
-- internal inputs; live authority and eventual foreign keys are NOT provided by
-- this foundation. One attempt cannot make another round to reset its budget.
CREATE TABLE socialgrowth_product.task_recovery_rounds (
  task_attempt_id uuid PRIMARY KEY,
  task_id uuid NOT NULL,
  device_id uuid NOT NULL REFERENCES socialgrowth_product.devices(device_id),
  round_id uuid NOT NULL UNIQUE,
  version bigint NOT NULL CHECK(version BETWEEN 0 AND 9007199254740991),
  phase text NOT NULL CHECK(phase IN ('available','recovering','human_required','verification_required')),
  record jsonb NOT NULL,
  CHECK ((jsonb_typeof(record)='object') IS TRUE),
  CHECK ((record->'scope'->>'taskAttemptId'=task_attempt_id::text) IS TRUE),
  CHECK ((record->'scope'->>'taskId'=task_id::text) IS TRUE),
  CHECK ((record->'scope'->>'deviceId'=device_id::text) IS TRUE),
  CHECK ((record->'scope'->>'roundId'=round_id::text) IS TRUE),
  CHECK (((record->>'version')::bigint=version) IS TRUE),
  CHECK ((record->>'phase'=phase) IS TRUE)
);

CREATE TABLE socialgrowth_product.task_recovery_commands (
  task_attempt_id uuid NOT NULL REFERENCES socialgrowth_product.task_recovery_rounds(task_attempt_id),
  request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  expected_version bigint NOT NULL CHECK(expected_version BETWEEN 0 AND 9007199254740991),
  kind text NOT NULL CHECK(kind IN ('initialize','begin','observe','complete','require_human')),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  applied_version bigint NOT NULL CHECK(applied_version BETWEEN 0 AND 9007199254740991),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(task_attempt_id,request_key)
);

-- No reset, new-human-round, HTTP, queue, execution permission or maintenance
-- budget API. Human/verification decisions are not physical stop evidence.
COMMIT;
