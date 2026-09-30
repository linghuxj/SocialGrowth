BEGIN;
-- Configured associations, NOT verified content attribution, approval, task,
-- platform clickability, real arrival or a monetization fact.
CREATE TABLE socialgrowth_product.tracking_links (
  link_id uuid PRIMARY KEY,
  public_token text NOT NULL UNIQUE CHECK(public_token ~ '^[A-Za-z0-9_-]{32}$'),
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  identity_id uuid NOT NULL REFERENCES socialgrowth_product.publishing_identities(identity_id),
  configured_content_unit_id uuid,
  target_url text NOT NULL CHECK(length(target_url) BETWEEN 1 AND 2048),
  policy_revision uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  created_by_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CHECK((status='revoked')=(revoked_at IS NOT NULL)),
  CHECK(revoked_at IS NULL OR revoked_at>=created_at)
);
CREATE TABLE socialgrowth_product.tracking_link_commands (
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  kind text NOT NULL CHECK(kind IN ('create','revoke')),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  link_id uuid NOT NULL REFERENCES socialgrowth_product.tracking_links(link_id),
  PRIMARY KEY(actor_id,request_key)
);
CREATE FUNCTION socialgrowth_product.reject_tracking_link_rebinding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'status'-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'revoked_at')
     OR (OLD.status='revoked' AND NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'Tracking link configuration is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tracking_link_immutable BEFORE UPDATE ON socialgrowth_product.tracking_links
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_tracking_link_rebinding();
CREATE TABLE socialgrowth_product.tracking_link_requests (
  record_id uuid PRIMARY KEY,
  link_id uuid NOT NULL REFERENCES socialgrowth_product.tracking_links(link_id),
  classification text NOT NULL CHECK(classification IN ('request','recognized_prefetch')),
  definition text NOT NULL CHECK(definition='request_records_prefetch_v1'),
  actual_content_source text NOT NULL DEFAULT 'unknown' CHECK(actual_content_source='unknown'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX tracking_link_requests_link_idx ON socialgrowth_product.tracking_link_requests(link_id,recorded_at,record_id);
CREATE FUNCTION socialgrowth_product.reject_tracking_request_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Tracking request records are immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tracking_request_immutable BEFORE UPDATE ON socialgrowth_product.tracking_link_requests
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.reject_tracking_request_rewrite();
-- No viewer fingerprint, raw request headers, credentials or automatic arrival
-- claim. Record-ID replay dedupe is not a configured repeat-visitor window.
COMMIT;
