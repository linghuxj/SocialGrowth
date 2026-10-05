BEGIN;

-- Per-device wireless ADB endpoints and current center connection observation.
-- This table records control-plane facts only; it grants no task permission.
CREATE TABLE socialgrowth_product.device_connection_states (
  device_id uuid PRIMARY KEY REFERENCES socialgrowth_product.devices(device_id),
  provider_id uuid NOT NULL REFERENCES socialgrowth_product.providers(provider_id),
  installation_id uuid NOT NULL REFERENCES socialgrowth_product.installations(installation_id),
  association_id uuid NOT NULL REFERENCES socialgrowth_product.device_associations(association_id),
  authority_mode text NOT NULL CHECK(authority_mode IN ('pilot_verified','formal_admitted')),
  network_binding_digest bytea NOT NULL CHECK(octet_length(network_binding_digest)=32),
  source_epoch uuid NOT NULL,
  source_generation bigint NOT NULL CHECK(source_generation > 0),
  epoch_request_id text NOT NULL CHECK(length(epoch_request_id) BETWEEN 8 AND 128),
  endpoint_revision bigint NOT NULL DEFAULT 0 CHECK(endpoint_revision BETWEEN 0 AND 9007199254740991),
  source_sequence text NOT NULL DEFAULT '0' CHECK(source_sequence ~ '^(0|[1-9][0-9]{0,18})$'),
  last_report_request_id text,
  last_report_digest bytea CHECK(last_report_digest IS NULL OR octet_length(last_report_digest)=32),
  connect_status text NOT NULL DEFAULT 'unknown' CHECK(connect_status IN ('candidate','withdrawn','unknown')),
  connect_port integer CHECK(connect_port BETWEEN 1 AND 65535),
  pairing_status text NOT NULL DEFAULT 'unknown' CHECK(pairing_status IN ('candidate','withdrawn','unknown')),
  pairing_port integer CHECK(pairing_port BETWEEN 1 AND 65535),
  endpoint_observed_at timestamptz,
  endpoint_received_at timestamptz,
  pairing_state text NOT NULL DEFAULT 'not_started' CHECK(pairing_state IN ('not_started','awaiting_code','pairing','paired','expired','unknown')),
  pairing_expires_at timestamptz,
  pairing_attempt_id uuid,
  connection_state text NOT NULL DEFAULT 'not_connected' CHECK(connection_state IN ('not_connected','connecting','connected','stale','unknown')),
  connected_endpoint_revision bigint,
  connected_at timestamptz,
  verified_hardware_serial text,
  blocker_code text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((connect_status='candidate')=(connect_port IS NOT NULL)),
  CHECK((pairing_status='candidate')=(pairing_port IS NOT NULL)),
  CHECK((last_report_request_id IS NULL)=(last_report_digest IS NULL)),
  CHECK((connection_state='connected')=(connected_endpoint_revision IS NOT NULL AND connected_at IS NOT NULL))
);

CREATE TABLE socialgrowth_product.device_connection_epoch_requests (
  installation_id uuid NOT NULL REFERENCES socialgrowth_product.installations(installation_id),
  request_id text NOT NULL CHECK(length(request_id) BETWEEN 8 AND 128),
  device_id uuid NOT NULL REFERENCES socialgrowth_product.devices(device_id),
  source_epoch uuid NOT NULL,
  source_generation bigint NOT NULL CHECK(source_generation > 0),
  request_digest bytea NOT NULL CHECK(octet_length(request_digest)=32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(installation_id,request_id),
  UNIQUE(source_epoch)
);

-- A pair attempt stores only request/scope/outcome facts. The six-digit pairing
-- code, and any code-derived value, must never be persisted.
CREATE TABLE socialgrowth_product.device_connection_pair_attempts (
  attempt_id uuid PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES socialgrowth_product.providers(provider_id),
  device_id uuid NOT NULL REFERENCES socialgrowth_product.devices(device_id),
  installation_id uuid NOT NULL REFERENCES socialgrowth_product.installations(installation_id),
  request_id text NOT NULL CHECK(length(request_id) BETWEEN 8 AND 128),
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
  expected_fact_version bigint NOT NULL CHECK(expected_fact_version >= 0),
  endpoint_revision bigint NOT NULL CHECK(endpoint_revision > 0),
  network_binding_digest bytea NOT NULL CHECK(octet_length(network_binding_digest)=32),
  status text NOT NULL CHECK(status IN ('processing','paired','connected','unknown','blocked')),
  blocker_code text,
  pairing_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(provider_id,idempotency_key)
);

CREATE INDEX device_connection_pair_attempt_device_idx
  ON socialgrowth_product.device_connection_pair_attempts(device_id,created_at DESC);

COMMIT;
