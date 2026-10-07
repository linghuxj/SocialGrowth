BEGIN;

-- First-key pin is an InstallationAuth-authorized trust bootstrap. It records
-- possession of the existing Android Keystore key; it is not hardware
-- attestation and is immutable for one installation generation.
CREATE TABLE socialgrowth_product.media_input_installation_keys (
  installation_id uuid NOT NULL REFERENCES socialgrowth_product.installations(installation_id),
  installation_generation bigint NOT NULL CHECK (installation_generation BETWEEN 1 AND 9007199254740991),
  key_id text NOT NULL UNIQUE CHECK (key_id ~ '^[a-f0-9]{64}$'),
  public_key_spki bytea NOT NULL CHECK (octet_length(public_key_spki) BETWEEN 1 AND 256),
  enrolled_session_id uuid NOT NULL REFERENCES socialgrowth_product.installation_sessions(session_id),
  enrolled_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (installation_id, installation_generation)
);

CREATE TABLE socialgrowth_product.media_input_enrollment_challenges (
  challenge_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL REFERENCES socialgrowth_product.installations(installation_id),
  installation_generation bigint NOT NULL CHECK (installation_generation BETWEEN 1 AND 9007199254740991),
  session_id uuid NOT NULL REFERENCES socialgrowth_product.installation_sessions(session_id),
  key_id text NOT NULL CHECK (key_id ~ '^[a-f0-9]{64}$'),
  public_key_spki bytea NOT NULL CHECK (octet_length(public_key_spki) BETWEEN 1 AND 256),
  challenge bytea NOT NULL CHECK (octet_length(challenge) = 32),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '2 minutes'),
  CHECK (consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at <= expires_at))
);
CREATE UNIQUE INDEX media_input_one_open_enrollment_challenge
  ON socialgrowth_product.media_input_enrollment_challenges(installation_id, installation_generation, session_id)
  WHERE consumed_at IS NULL;

-- A pending envelope digest is recorded before delivery. The phone consumes
-- it after receiving SGME and before decrypting or performing any UI effect.
CREATE TABLE socialgrowth_product.media_input_pending_grants (
  action_id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  account_id uuid NOT NULL REFERENCES socialgrowth_product.media_accounts(account_id),
  platform text NOT NULL CHECK (platform IN ('facebook','youtube')),
  credential_id uuid NOT NULL,
  credential_revision bigint NOT NULL CHECK (credential_revision BETWEEN 1 AND 9007199254740991),
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  task_id uuid NOT NULL REFERENCES socialgrowth_product.account_preparation_tasks(task_id),
  task_attempt_id uuid NOT NULL REFERENCES socialgrowth_product.artemis_preparation_intents(task_attempt_id),
  device_id uuid NOT NULL REFERENCES socialgrowth_product.devices(device_id),
  installation_id uuid NOT NULL REFERENCES socialgrowth_product.installations(installation_id),
  installation_generation bigint NOT NULL CHECK (installation_generation BETWEEN 1 AND 9007199254740991),
  session_id uuid NOT NULL REFERENCES socialgrowth_product.installation_sessions(session_id),
  authorization_id uuid NOT NULL,
  holder_id uuid NOT NULL,
  control_generation bigint NOT NULL CHECK (control_generation BETWEEN 1 AND 9007199254740991),
  field_ref text NOT NULL CHECK (field_ref IN ('login','password','submit_login')),
  target_view_id_resource_name text,
  action_scope jsonb NOT NULL CHECK (jsonb_typeof(action_scope) = 'object'),
  hello_proof_frame bytea NOT NULL CHECK (octet_length(hello_proof_frame) BETWEEN 1 AND 1024),
  envelope_sha256 bytea NOT NULL CHECK (octet_length(envelope_sha256) = 32),
  request_sha256 bytea NOT NULL CHECK (octet_length(request_sha256) = 32),
  session_nonce bytea NOT NULL CHECK (octet_length(session_nonce) = 32),
  hello_proof_sha256 bytea NOT NULL CHECK (octet_length(hello_proof_sha256) = 32),
  device_public_key_sha256 bytea NOT NULL CHECK (octet_length(device_public_key_sha256) = 32),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (request_id = action_id),
  CHECK ((field_ref = 'submit_login') = (target_view_id_resource_name IS NOT NULL)),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 seconds'),
  CHECK (consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at <= expires_at)),
  FOREIGN KEY (credential_id, account_id, platform)
    REFERENCES socialgrowth_product.media_credentials(credential_id, account_id, platform)
);

CREATE TABLE socialgrowth_product.media_input_status_receipts (
  action_id uuid NOT NULL REFERENCES socialgrowth_product.media_input_pending_grants(action_id),
  sequence bigint NOT NULL CHECK (sequence BETWEEN 1 AND 9007199254740991),
  phase smallint NOT NULL CHECK (phase BETWEEN 1 AND 6),
  status_frame bytea NOT NULL CHECK (octet_length(status_frame) BETWEEN 1 AND 8192),
  frame_sha256 bytea NOT NULL CHECK (octet_length(frame_sha256) = 32),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (action_id, sequence),
  UNIQUE (action_id, frame_sha256)
);

CREATE FUNCTION socialgrowth_product.guard_media_input_enrollment_challenge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.challenge_id IS DISTINCT FROM OLD.challenge_id
    OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
    OR NEW.installation_generation IS DISTINCT FROM OLD.installation_generation
    OR NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.key_id IS DISTINCT FROM OLD.key_id
    OR NEW.public_key_spki IS DISTINCT FROM OLD.public_key_spki OR NEW.challenge IS DISTINCT FROM OLD.challenge
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
  THEN RAISE EXCEPTION 'Media input enrollment challenge is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER media_input_enrollment_challenge_history
  BEFORE UPDATE OR DELETE ON socialgrowth_product.media_input_enrollment_challenges
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_media_input_enrollment_challenge();

CREATE FUNCTION socialgrowth_product.guard_media_input_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Media input installation key is immutable'; END $$;
CREATE TRIGGER media_input_key_history
  BEFORE UPDATE OR DELETE ON socialgrowth_product.media_input_installation_keys
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_media_input_key();

CREATE FUNCTION socialgrowth_product.guard_media_input_pending_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.action_id IS DISTINCT FROM OLD.action_id
    OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.account_id IS DISTINCT FROM OLD.account_id
    OR NEW.platform IS DISTINCT FROM OLD.platform OR NEW.credential_id IS DISTINCT FROM OLD.credential_id
    OR NEW.credential_revision IS DISTINCT FROM OLD.credential_revision OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.task_id IS DISTINCT FROM OLD.task_id OR NEW.task_attempt_id IS DISTINCT FROM OLD.task_attempt_id
    OR NEW.device_id IS DISTINCT FROM OLD.device_id OR NEW.installation_id IS DISTINCT FROM OLD.installation_id
    OR NEW.installation_generation IS DISTINCT FROM OLD.installation_generation OR NEW.session_id IS DISTINCT FROM OLD.session_id
    OR NEW.authorization_id IS DISTINCT FROM OLD.authorization_id OR NEW.holder_id IS DISTINCT FROM OLD.holder_id
    OR NEW.control_generation IS DISTINCT FROM OLD.control_generation OR NEW.field_ref IS DISTINCT FROM OLD.field_ref
    OR NEW.target_view_id_resource_name IS DISTINCT FROM OLD.target_view_id_resource_name
    OR NEW.action_scope IS DISTINCT FROM OLD.action_scope OR NEW.hello_proof_frame IS DISTINCT FROM OLD.hello_proof_frame
    OR NEW.envelope_sha256 IS DISTINCT FROM OLD.envelope_sha256
    OR NEW.request_sha256 IS DISTINCT FROM OLD.request_sha256 OR NEW.session_nonce IS DISTINCT FROM OLD.session_nonce
    OR NEW.hello_proof_sha256 IS DISTINCT FROM OLD.hello_proof_sha256
    OR NEW.device_public_key_sha256 IS DISTINCT FROM OLD.device_public_key_sha256
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
  THEN RAISE EXCEPTION 'Media input pending grant is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER media_input_pending_grant_history
  BEFORE UPDATE OR DELETE ON socialgrowth_product.media_input_pending_grants
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_media_input_pending_grant();

CREATE FUNCTION socialgrowth_product.reject_media_input_status_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Media input status receipt is immutable'; END $$;
CREATE TRIGGER media_input_status_history
  BEFORE UPDATE OR DELETE ON socialgrowth_product.media_input_status_receipts
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_media_input_status_change();

COMMIT;
