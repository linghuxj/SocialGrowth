BEGIN;

CREATE SCHEMA IF NOT EXISTS socialgrowth_product;

CREATE TABLE socialgrowth_product.operators (
  operator_id uuid PRIMARY KEY,
  login_name text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE socialgrowth_product.operator_sessions (
  session_id uuid PRIMARY KEY,
  operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  token_digest bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (expires_at > created_at)
);

CREATE TABLE socialgrowth_product.provider_invitations (
  invitation_id uuid PRIMARY KEY,
  code_digest bytea NOT NULL UNIQUE,
  created_by_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  max_uses integer NOT NULL CHECK (max_uses > 0),
  consumed_uses integer NOT NULL DEFAULT 0 CHECK (consumed_uses >= 0),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (consumed_uses <= max_uses),
  CHECK (expires_at > created_at)
);

CREATE TABLE socialgrowth_product.phone_verifications (
  verification_id uuid PRIMARY KEY,
  phone_e164 text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('provider_registration', 'provider_login', 'phone_rebind')),
  provider_id uuid,
  verified_at timestamptz,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  CHECK (expires_at > created_at),
  CHECK (consumed_at IS NULL OR verified_at IS NOT NULL)
);

CREATE TABLE socialgrowth_product.providers (
  provider_id uuid PRIMARY KEY,
  phone_e164 text NOT NULL UNIQUE,
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (phone_e164 ~ '^\\+[1-9][0-9]{7,14}$'),
  CHECK (length(btrim(display_name)) > 0)
);

ALTER TABLE socialgrowth_product.phone_verifications
  ADD CONSTRAINT phone_verifications_provider_fk
  FOREIGN KEY (provider_id) REFERENCES socialgrowth_product.providers(provider_id);

CREATE TABLE socialgrowth_product.provider_invitation_consumptions (
  consumption_id uuid PRIMARY KEY,
  invitation_id uuid NOT NULL REFERENCES socialgrowth_product.provider_invitations(invitation_id),
  provider_id uuid NOT NULL UNIQUE REFERENCES socialgrowth_product.providers(provider_id),
  verification_id uuid NOT NULL UNIQUE REFERENCES socialgrowth_product.phone_verifications(verification_id),
  consumed_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE INDEX provider_invitation_consumptions_invitation_idx
  ON socialgrowth_product.provider_invitation_consumptions(invitation_id);

CREATE TABLE socialgrowth_product.provider_sessions (
  session_id uuid PRIMARY KEY,
  provider_id uuid NOT NULL REFERENCES socialgrowth_product.providers(provider_id),
  token_digest bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (expires_at > created_at)
);

CREATE TABLE socialgrowth_product.installations (
  installation_id uuid PRIMARY KEY,
  credential_digest bytea NOT NULL UNIQUE,
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  status text NOT NULL CHECK (status IN ('active', 'replaced', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp()
);

CREATE TABLE socialgrowth_product.installation_sessions (
  session_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES socialgrowth_product.installations(installation_id),
  token_digest bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (expires_at > created_at)
);

CREATE TABLE socialgrowth_product.devices (
  device_id uuid PRIMARY KEY,
  display_name text NOT NULL,
  fact_version bigint NOT NULL DEFAULT 0 CHECK (fact_version >= 0),
  state text NOT NULL CHECK (state IN (
    'unassociated',
    'associated_pending_access',
    'access_ready',
    'paused',
    'exit_pending',
    'exited'
  )),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (length(btrim(display_name)) > 0)
);

CREATE TABLE socialgrowth_product.association_sessions (
  association_session_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES socialgrowth_product.installations(installation_id),
  expected_installation_generation bigint NOT NULL CHECK (expected_installation_generation > 0),
  code_digest bytea NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by_provider_id uuid REFERENCES socialgrowth_product.providers(provider_id),
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (expires_at > created_at),
  CHECK ((consumed_at IS NULL) = (consumed_by_provider_id IS NULL)),
  CHECK (consumed_at IS NULL OR invalidated_at IS NULL)
);

CREATE UNIQUE INDEX association_sessions_one_open_per_installation_idx
  ON socialgrowth_product.association_sessions(installation_id)
  WHERE consumed_at IS NULL AND invalidated_at IS NULL;

CREATE TABLE socialgrowth_product.device_associations (
  association_id uuid PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES socialgrowth_product.devices(device_id),
  installation_id uuid NOT NULL REFERENCES socialgrowth_product.installations(installation_id),
  provider_id uuid NOT NULL REFERENCES socialgrowth_product.providers(provider_id),
  association_session_id uuid NOT NULL UNIQUE REFERENCES socialgrowth_product.association_sessions(association_session_id),
  confirmed_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  ended_at timestamptz,
  CHECK (ended_at IS NULL OR ended_at >= confirmed_at)
);

CREATE UNIQUE INDEX device_associations_current_device_idx
  ON socialgrowth_product.device_associations(device_id)
  WHERE ended_at IS NULL;

CREATE UNIQUE INDEX device_associations_current_installation_idx
  ON socialgrowth_product.device_associations(installation_id)
  WHERE ended_at IS NULL;

CREATE TABLE socialgrowth_product.idempotency_requests (
  idempotency_request_id uuid PRIMARY KEY,
  operation text NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('operator', 'provider', 'installation', 'registration')),
  principal_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  request_digest bytea NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'succeeded', 'failed')),
  response_status integer,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  UNIQUE (operation, principal_type, principal_id, idempotency_key),
  CHECK (expires_at > created_at),
  CHECK ((status = 'processing') = (response_status IS NULL)),
  CHECK (response_body IS NULL OR response_status IS NOT NULL)
);

CREATE TABLE socialgrowth_product.audit_records (
  audit_record_id uuid PRIMARY KEY,
  actor_type text NOT NULL CHECK (actor_type IN ('operator', 'provider', 'installation', 'system')),
  actor_id uuid,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  request_id text NOT NULL,
  facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK ((actor_type = 'system') OR actor_id IS NOT NULL)
);

COMMIT;
