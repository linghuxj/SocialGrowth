BEGIN;
-- Operator-declared reference registry only; no platform verification, media
-- credential, current permission or acceptance/commission start.
CREATE TABLE socialgrowth_product.media_registry_commands (
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL CHECK (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  payload_digest bytea NOT NULL CHECK (octet_length(payload_digest)=32),
  identity_id uuid NOT NULL REFERENCES socialgrowth_product.publishing_identities(identity_id),
  applied_version bigint NOT NULL CHECK (applied_version BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (actor_id,request_key)
);
CREATE TRIGGER media_registry_command_immutable BEFORE UPDATE ON socialgrowth_product.media_registry_commands
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_resource_registry_change();
COMMIT;
