BEGIN;
-- Controlled encrypted records only. No device/initialization permission,
-- acceptance start or platform login fact is created by this migration.
CREATE TABLE socialgrowth_product.media_credential_revisions (
  credential_id uuid NOT NULL,
  account_id uuid NOT NULL,
  platform text NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  state text NOT NULL CHECK (state IN ('stored_unverified','invalidated')),
  encryption_key_id text,
  envelope jsonb,
  recorded_by uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (credential_id,revision),
  UNIQUE (credential_id,account_id,platform,revision),
  FOREIGN KEY (account_id,platform) REFERENCES socialgrowth_product.media_accounts(account_id,platform),
  CHECK ((state='invalidated' AND envelope IS NULL AND encryption_key_id IS NULL) OR
    (state='stored_unverified' AND envelope IS NOT NULL AND encryption_key_id IS NOT NULL
      AND encryption_key_id ~ '^[A-Za-z0-9_-]{1,100}$'
      AND jsonb_typeof(envelope)='object'
      AND envelope - ARRAY['format','context','keyId','payloadBytes','nonce','tag','ciphertext'] = '{}'::jsonb
      AND envelope ?& ARRAY['format','context','keyId','payloadBytes','nonce','tag','ciphertext']
      AND jsonb_typeof(envelope->'context')='object'
      AND (envelope->'context') - ARRAY['credentialId','accountId','platform','revision'] = '{}'::jsonb
      AND octet_length(envelope::text) <= 16000
      AND envelope->>'format'='2026-10-01.media-credential-v1'
      AND envelope->>'keyId'=encryption_key_id
      AND envelope->'context'->>'credentialId'=credential_id::text
      AND envelope->'context'->>'accountId'=account_id::text
      AND envelope->'context'->>'platform'=platform
      AND envelope->'context'->>'revision'=revision::text) IS TRUE)
);
CREATE TABLE socialgrowth_product.media_credentials (
  credential_id uuid PRIMARY KEY,
  account_id uuid NOT NULL UNIQUE,
  platform text NOT NULL,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  UNIQUE (credential_id,account_id,platform),
  FOREIGN KEY (credential_id,account_id,platform,revision)
    REFERENCES socialgrowth_product.media_credential_revisions(credential_id,account_id,platform,revision)
);
-- A historical revision cannot silently reuse the same credential UUID for
-- another account/platform. Deferred solely to allow first revision + head in
-- one transaction; missing head rejects COMMIT, including suppressed inserts.
ALTER TABLE socialgrowth_product.media_credential_revisions ADD CONSTRAINT media_credential_history_identity
  FOREIGN KEY (credential_id,account_id,platform)
  REFERENCES socialgrowth_product.media_credentials(credential_id,account_id,platform) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE socialgrowth_product.media_credential_commands (
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  digest_key_id text NOT NULL CHECK (digest_key_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  payload_digest bytea NOT NULL CHECK (octet_length(payload_digest)=32),
  credential_id uuid NOT NULL,
  account_id uuid NOT NULL,
  platform text NOT NULL,
  applied_revision bigint NOT NULL,
  PRIMARY KEY (actor_id,request_key),
  FOREIGN KEY (credential_id,account_id,platform,applied_revision)
    REFERENCES socialgrowth_product.media_credential_revisions(credential_id,account_id,platform,revision)
);
CREATE FUNCTION socialgrowth_product.reject_media_credential_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Controlled credential history is immutable'; END $$;
CREATE TRIGGER media_credential_revision_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.media_credential_revisions
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_media_credential_history_change();
CREATE TRIGGER media_credential_command_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.media_credential_commands
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_media_credential_history_change();
CREATE FUNCTION socialgrowth_product.guard_media_credential_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Controlled credential identity is immutable'; END IF;
  IF NEW.credential_id<>OLD.credential_id OR NEW.account_id<>OLD.account_id OR NEW.platform<>OLD.platform
    OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Invalid controlled credential revision'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER media_credential_head_guard BEFORE UPDATE OR DELETE ON socialgrowth_product.media_credentials
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_media_credential_head();
COMMIT;
