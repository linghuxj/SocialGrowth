BEGIN;
-- Internal initial-reservation ledger. Registry source is not yet wired to a
-- provisioning/verification adapter. Keys MUST be canonical platform source
-- identifiers, never display names, URLs, credentials or model guesses.
CREATE TABLE socialgrowth_product.media_accounts (
  account_id uuid PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('facebook','youtube')),
  canonical_account_ref text NOT NULL CHECK (canonical_account_ref ~ '^[A-Za-z0-9_-]{1,150}$'),
  UNIQUE(platform,canonical_account_ref), UNIQUE(account_id,platform)
);
CREATE TABLE socialgrowth_product.publishing_identities (
  identity_id uuid PRIMARY KEY,
  account_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('facebook','youtube')),
  canonical_identity_ref text NOT NULL CHECK (canonical_identity_ref ~ '^[A-Za-z0-9_-]{1,150}$'),
  FOREIGN KEY(account_id,platform) REFERENCES socialgrowth_product.media_accounts(account_id,platform),
  UNIQUE(platform,canonical_identity_ref), UNIQUE(identity_id,account_id,platform)
);
-- UUID, platform/account links and canonical source references are immutable.
-- A changed real identity must not inherit reservations or historical ownership.
CREATE FUNCTION socialgrowth_product.reject_resource_registry_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Resource registry references are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER media_account_immutable BEFORE UPDATE ON socialgrowth_product.media_accounts
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_resource_registry_change();
CREATE TRIGGER publishing_identity_immutable BEFORE UPDATE ON socialgrowth_product.publishing_identities
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_resource_registry_change();
CREATE TABLE socialgrowth_product.resource_reservation_guard (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  version bigint NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 9007199254740991)
);
INSERT INTO socialgrowth_product.resource_reservation_guard(singleton) VALUES(true);
CREATE TABLE socialgrowth_product.project_device_reservations (
  device_id uuid PRIMARY KEY REFERENCES socialgrowth_product.devices(device_id),
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  UNIQUE(device_id,project_id)
);
CREATE TABLE socialgrowth_product.project_account_reservations (
  account_id uuid PRIMARY KEY REFERENCES socialgrowth_product.media_accounts(account_id),
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  UNIQUE(account_id,project_id)
);
CREATE TABLE socialgrowth_product.project_identity_reservations (
  identity_id uuid PRIMARY KEY,
  account_id uuid NOT NULL, platform text NOT NULL,
  device_id uuid NOT NULL, project_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending_initialization' CHECK(state='pending_initialization'),
  reserved_by_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(identity_id,account_id,platform) REFERENCES socialgrowth_product.publishing_identities(identity_id,account_id,platform),
  FOREIGN KEY(device_id,project_id) REFERENCES socialgrowth_product.project_device_reservations(device_id,project_id),
  FOREIGN KEY(account_id,project_id) REFERENCES socialgrowth_product.project_account_reservations(account_id,project_id),
  UNIQUE(device_id,platform)
);
CREATE TABLE socialgrowth_product.resource_reservation_commands (
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  applied_version bigint NOT NULL CHECK(applied_version BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(actor_id,request_key)
);
-- No release/rotation/transfer, no acceptance start, no readiness grant and no
-- task producer. Project end/pause/operator disable cannot free these resources.
COMMIT;
