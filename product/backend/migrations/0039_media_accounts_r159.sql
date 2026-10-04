BEGIN;
-- A registered company login account is not a platform's canonical parent ID.
-- Old registrations remain as legacy facts; new account records use nullable
-- canonical refs until an actual trusted platform readback verifies one.
DROP TRIGGER media_account_immutable ON socialgrowth_product.media_accounts;
ALTER TABLE socialgrowth_product.media_accounts
  ALTER COLUMN canonical_account_ref DROP NOT NULL,
  ADD COLUMN display_name text,
  ADD COLUMN login_identifier text,
  ADD COLUMN normalized_login_identifier text,
  ADD COLUMN legacy_declared_canonical_account_ref text,
  ADD COLUMN persona jsonb,
  ADD COLUMN parent_login_verification text NOT NULL DEFAULT 'registered_unverified'
    CHECK (parent_login_verification IN ('registered_unverified','verified','blocked'));
ALTER TABLE socialgrowth_product.media_accounts
  ADD CONSTRAINT media_account_profile_shape CHECK (
    (display_name IS NULL OR (length(display_name) BETWEEN 1 AND 200 AND display_name= btrim(display_name))) AND
    (login_identifier IS NULL OR (length(login_identifier) BETWEEN 1 AND 320 AND login_identifier=btrim(login_identifier))) AND
    (normalized_login_identifier IS NULL OR normalized_login_identifier=lower(btrim(login_identifier))) AND
    (persona IS NULL OR (jsonb_typeof(persona)='object' AND persona - ARRAY['name','birthday','gender']='{}'::jsonb)) AND
    (parent_login_verification<>'verified' OR canonical_account_ref IS NOT NULL)
  ),
  ADD CONSTRAINT media_account_canonical_shape CHECK (canonical_account_ref IS NULL OR canonical_account_ref ~ '^[A-Za-z0-9_-]{1,150}$');
-- Preserve the operator-declared old reference as unverified history. It does
-- not become a canonical platform ID or a deduplication fact.
UPDATE socialgrowth_product.media_accounts
SET legacy_declared_canonical_account_ref=canonical_account_ref, canonical_account_ref=NULL
WHERE parent_login_verification='registered_unverified' AND canonical_account_ref IS NOT NULL;
ALTER TABLE socialgrowth_product.media_accounts ADD CONSTRAINT media_account_legacy_ref_shape
  CHECK ((legacy_declared_canonical_account_ref IS NULL OR legacy_declared_canonical_account_ref ~ '^[A-Za-z0-9_-]{1,150}$') AND
    (legacy_declared_canonical_account_ref IS NULL OR parent_login_verification<>'verified'));
CREATE UNIQUE INDEX media_accounts_login_identifier_unique
  ON socialgrowth_product.media_accounts(platform,normalized_login_identifier)
  WHERE normalized_login_identifier IS NOT NULL;
CREATE FUNCTION socialgrowth_product.guard_media_account_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.platform IS DISTINCT FROM OLD.platform THEN
    RAISE EXCEPTION 'Media account identity is immutable';
  END IF;
  IF NEW.legacy_declared_canonical_account_ref IS DISTINCT FROM OLD.legacy_declared_canonical_account_ref THEN
    RAISE EXCEPTION 'Legacy canonical declaration is immutable';
  END IF;
  IF NEW.canonical_account_ref IS DISTINCT FROM OLD.canonical_account_ref AND NOT
    (OLD.canonical_account_ref IS NULL AND NEW.canonical_account_ref IS NOT NULL AND NEW.parent_login_verification='verified') THEN
    RAISE EXCEPTION 'Canonical platform account reference requires verified readback';
  END IF;
  IF OLD.parent_login_verification='verified' AND NEW.parent_login_verification IS DISTINCT FROM OLD.parent_login_verification
    AND NEW.parent_login_verification<>'registered_unverified' THEN
    RAISE EXCEPTION 'Verified parent identity can only be invalidated by credential rotation';
  END IF;
  IF OLD.parent_login_verification='verified' AND NEW.login_identifier IS DISTINCT FROM OLD.login_identifier
    AND NEW.parent_login_verification<>'registered_unverified' THEN
    RAISE EXCEPTION 'Changing a verified login identifier invalidates current parent verification';
  END IF;
  IF OLD.parent_login_verification='blocked' AND NEW.parent_login_verification IS DISTINCT FROM OLD.parent_login_verification THEN
    RAISE EXCEPTION 'Blocked parent identity is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER media_account_immutable BEFORE UPDATE ON socialgrowth_product.media_accounts
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_media_account_profile();
ALTER TABLE socialgrowth_product.account_preparation_tasks ALTER COLUMN parent_login_ref DROP NOT NULL;
ALTER TABLE socialgrowth_product.account_preparation_tasks DROP CONSTRAINT account_preparation_tasks_parent_login_ref_check;
ALTER TABLE socialgrowth_product.account_preparation_tasks ADD CONSTRAINT account_preparation_tasks_parent_ref_shape
  CHECK (parent_login_ref IS NULL OR parent_login_ref ~ '^[A-Za-z0-9_-]{1,150}$');
CREATE UNIQUE INDEX account_preparation_project_account_unique
  ON socialgrowth_product.account_preparation_tasks(project_id,selected_account_id,platform)
  WHERE selected_account_id IS NOT NULL;
-- Existing project/account reservations predate a device selection. This
-- child assignment allows pre-Page reservations and makes account->one phone
-- explicit while retaining project_account_reservations for old consumers.
CREATE TABLE socialgrowth_product.project_media_account_assignments (
  account_id uuid PRIMARY KEY REFERENCES socialgrowth_product.media_accounts(account_id),
  platform text NOT NULL,
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  device_id uuid NOT NULL REFERENCES socialgrowth_product.devices(device_id),
  state text NOT NULL DEFAULT 'pending_initialization' CHECK(state='pending_initialization'),
  handover_requested boolean NOT NULL DEFAULT false,
  reserved_by_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(account_id,platform) REFERENCES socialgrowth_product.media_accounts(account_id,platform),
  UNIQUE(device_id,platform)
);
-- Carry every existing account+phone binding forward before new account-only
-- assignment APIs become available. Deliberately do not use ON CONFLICT: if
-- legacy history assigned one account to multiple projects/devices, or two
-- same-platform accounts to one device, migration must stop for reconciliation
-- instead of silently selecting one binding.
INSERT INTO socialgrowth_product.project_media_account_assignments(account_id,platform,project_id,device_id,state,handover_requested,reserved_by_operator_id,reserved_at)
SELECT DISTINCT ON (account_id,platform,project_id,device_id)
  account_id,platform,project_id,device_id,state,false,reserved_by_operator_id,reserved_at
FROM socialgrowth_product.project_identity_reservations
ORDER BY account_id,platform,project_id,device_id,reserved_at,identity_id;
UPDATE socialgrowth_product.resource_reservation_guard
SET version=version+1
WHERE singleton=true AND EXISTS (SELECT 1 FROM socialgrowth_product.project_media_account_assignments);
CREATE TABLE socialgrowth_product.resource_handover_requests (
  handover_id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  account_ids uuid[] NOT NULL CHECK(cardinality(account_ids) BETWEEN 1 AND 2),
  source_project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  source_device_id uuid NOT NULL REFERENCES socialgrowth_product.devices(device_id),
  target_project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  target_device_id uuid NOT NULL REFERENCES socialgrowth_product.devices(device_id),
  state text NOT NULL DEFAULT 'blocked' CHECK(state='blocked'),
  reason text NOT NULL CHECK(reason IN ('trusted_old_stop_unavailable','unresolved_task_source_unavailable','tail_collection_source_unavailable')),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(actor_id,request_key)
);
CREATE FUNCTION socialgrowth_product.guard_media_account_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Account assignment cannot be released without trusted handover facts'; END IF;
  IF NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.platform IS DISTINCT FROM OLD.platform
    OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.device_id IS DISTINCT FROM OLD.device_id
    OR NEW.state IS DISTINCT FROM OLD.state OR NEW.reserved_by_operator_id IS DISTINCT FROM OLD.reserved_by_operator_id
    OR NEW.reserved_at IS DISTINCT FROM OLD.reserved_at
    OR (OLD.handover_requested AND NEW.handover_requested IS DISTINCT FROM OLD.handover_requested) THEN
    RAISE EXCEPTION 'Account assignment is immutable except for a one-way handover request';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER media_account_assignment_guard BEFORE UPDATE OR DELETE ON socialgrowth_product.project_media_account_assignments
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_media_account_assignment();
CREATE TRIGGER resource_handover_request_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.resource_handover_requests
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_direction_history_change();
CREATE TABLE socialgrowth_product.resource_account_assignment_commands (
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  account_id uuid NOT NULL REFERENCES socialgrowth_product.media_accounts(account_id),
  applied_version bigint NOT NULL CHECK(applied_version BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(actor_id,request_key)
);
CREATE TRIGGER resource_account_assignment_command_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.resource_account_assignment_commands
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_direction_history_change();
CREATE TRIGGER resource_account_assignment_command_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.resource_account_assignment_commands
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_direction_history_change();
CREATE TABLE socialgrowth_product.media_account_commands (
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  command_kind text NOT NULL CHECK(command_kind IN ('account_create','profile_update','credential_put','credential_invalidate')),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  digest_key_id text NOT NULL CHECK(digest_key_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  account_id uuid NOT NULL REFERENCES socialgrowth_product.media_accounts(account_id),
  applied_version bigint NOT NULL CHECK(applied_version BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY(actor_id,request_key)
);
-- Preserve already-applied credential idempotency keys in the shared account
-- command namespace before new profile/create/credential routes use it.
INSERT INTO socialgrowth_product.media_account_commands(actor_id,request_key,command_kind,payload_digest,digest_key_id,account_id,applied_version)
SELECT c.actor_id,c.request_key,CASE WHEN r.state='stored_unverified' THEN 'credential_put' ELSE 'credential_invalidate' END,
  c.payload_digest,c.digest_key_id,c.account_id,g.version
FROM socialgrowth_product.media_credential_commands c
JOIN socialgrowth_product.media_credential_revisions r
  ON (r.credential_id,r.account_id,r.platform,r.revision)=(c.credential_id,c.account_id,c.platform,c.applied_revision)
CROSS JOIN socialgrowth_product.resource_reservation_guard g;
CREATE TRIGGER media_account_command_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.media_account_commands
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_direction_history_change();
-- Deliberately no RELEASE/TRANSFER path: trusted stop, unresolved-task and tail
-- collection sources do not yet exist. Recording a request never frees a row.
COMMIT;
