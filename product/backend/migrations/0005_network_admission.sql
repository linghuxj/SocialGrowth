BEGIN;

-- Enrollment changes never mark a device business-ready. These are control-plane
-- facts; network operations must be delivered outside the database transaction.
CREATE TABLE socialgrowth_product.network_enrollments (
  enrollment_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES socialgrowth_product.installations(installation_id),
  device_id uuid NOT NULL REFERENCES socialgrowth_product.devices(device_id),
  association_id uuid NOT NULL REFERENCES socialgrowth_product.device_associations(association_id),
  provider_id uuid NOT NULL REFERENCES socialgrowth_product.providers(provider_id),
  generation bigint NOT NULL CHECK (generation > 0),
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 16 AND 128),
  key_digest bytea NOT NULL,
  version bigint NOT NULL CHECK (version BETWEEN 0 AND 9007199254740991),
  phase text NOT NULL CHECK (phase IN ('awaiting_restriction','restricted','proof_verified','permission_pending','admitted','reclaim_pending','reclaimed')),
  candidate_node_id text,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  UNIQUE (installation_id, request_key),
  UNIQUE (device_id, generation),
  CHECK ((jsonb_typeof(record) = 'object') IS TRUE),
  CHECK ((record->>'enrollmentId' = enrollment_id::text) IS TRUE),
  CHECK (((record->>'version')::bigint = version) IS TRUE),
  CHECK ((record->>'phase' = phase) IS TRUE),
  CHECK ((record->'authority'->>'deviceId' = device_id::text) IS TRUE),
  CHECK ((record->'authority'->>'installationId' = installation_id::text) IS TRUE),
  CHECK ((record->'authority'->>'enrollmentGeneration' = generation::text) IS TRUE)
);
CREATE UNIQUE INDEX network_enrollments_current_device_idx
  ON socialgrowth_product.network_enrollments(device_id) WHERE phase <> 'reclaimed';
-- Reserve a candidate even before proof; reclamation uncertainty keeps the claim.
CREATE UNIQUE INDEX network_enrollments_current_node_idx
  ON socialgrowth_product.network_enrollments(candidate_node_id)
  WHERE candidate_node_id IS NOT NULL AND phase <> 'reclaimed';

CREATE TABLE socialgrowth_product.network_enrollment_commands (
  enrollment_id uuid NOT NULL REFERENCES socialgrowth_product.network_enrollments(enrollment_id),
  request_key text NOT NULL CHECK (length(request_key) BETWEEN 16 AND 128),
  payload_digest bytea NOT NULL,
  command_kind text NOT NULL CHECK (command_kind IN ('confirm_restriction','issue_challenge','consume_proof','request_permission','confirm_permission','request_reclamation','confirm_reclamation')),
  applied_version bigint NOT NULL CHECK (applied_version >= 0),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (enrollment_id, request_key)
);

CREATE TABLE socialgrowth_product.network_operation_intents (
  operation_id uuid PRIMARY KEY,
  enrollment_id uuid NOT NULL REFERENCES socialgrowth_product.network_enrollments(enrollment_id),
  expected_version bigint NOT NULL CHECK (expected_version >= 0),
  kind text NOT NULL CHECK (kind IN ('apply_restricted_policy','issue_restricted_credential','apply_formal_policy','revoke_credential','revoke_node_access')),
  reclamation_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cancelled','confirmed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (enrollment_id, expected_version, kind),
  CHECK ((kind IN ('revoke_credential','revoke_node_access')) = (reclamation_id IS NOT NULL))
);
-- No delivery worker exists in stage two. Do not infer external success from an
-- intent, its cancellation, an auth-key expiry or an enrollment deadline.
COMMIT;
