BEGIN;

ALTER TABLE socialgrowth_product.network_enrollments
  ADD CONSTRAINT network_enrollments_endpoint_scope_unique UNIQUE(enrollment_id,installation_id,device_id);

-- Internal authenticated journal. No route, executor/outbox or network grant.
CREATE TABLE socialgrowth_product.endpoint_report_journals (
  enrollment_id uuid PRIMARY KEY,
  installation_id uuid NOT NULL,
  device_id uuid NOT NULL,
  endpoint_revision bigint NOT NULL CHECK(endpoint_revision BETWEEN 1 AND 9007199254740991),
  record jsonb NOT NULL,
  FOREIGN KEY(enrollment_id,installation_id,device_id)
    REFERENCES socialgrowth_product.network_enrollments(enrollment_id,installation_id,device_id),
  CHECK((jsonb_typeof(record)='object') IS TRUE),
  CHECK((record->'scope'->>'enrollmentId'=enrollment_id::text) IS TRUE),
  CHECK((record->'scope'->>'installationId'=installation_id::text) IS TRUE),
  CHECK((record->'scope'->>'deviceId'=device_id::text) IS TRUE),
  CHECK(((record->>'endpointRevision')::bigint=endpoint_revision) IS TRUE),
  CHECK((jsonb_typeof(record->'epochs')='array') IS TRUE),
  CHECK((jsonb_typeof(record->'receipts')='array') IS TRUE)
);

CREATE TABLE socialgrowth_product.endpoint_report_receipts (
  enrollment_id uuid NOT NULL REFERENCES socialgrowth_product.endpoint_report_journals(enrollment_id),
  report_id uuid NOT NULL,
  source_epoch uuid NOT NULL,
  source_sequence text NOT NULL CHECK(source_sequence ~ '^[1-9][0-9]{0,18}$'),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  endpoint_revision bigint NOT NULL CHECK(endpoint_revision BETWEEN 1 AND 9007199254740991),
  received_at timestamptz NOT NULL,
  PRIMARY KEY(enrollment_id,report_id),
  UNIQUE(enrollment_id,source_epoch,source_sequence)
);

CREATE FUNCTION socialgrowth_product.guard_endpoint_report_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.enrollment_id<>OLD.enrollment_id OR NEW.installation_id<>OLD.installation_id OR NEW.device_id<>OLD.device_id
    OR NEW.record->'scope' IS DISTINCT FROM OLD.record->'scope'
    OR NEW.record->'publicKeySpki' IS DISTINCT FROM OLD.record->'publicKeySpki'
    OR NEW.endpoint_revision<OLD.endpoint_revision
    OR jsonb_array_length(NEW.record->'epochs')<jsonb_array_length(OLD.record->'epochs')
    OR jsonb_array_length(NEW.record->'receipts')<jsonb_array_length(OLD.record->'receipts')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.record->'epochs') WITH ORDINALITY x(v,n)
      WHERE x.v IS DISTINCT FROM NEW.record->'epochs'->((x.n-1)::int))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(OLD.record->'receipts') WITH ORDINALITY x(v,n)
      WHERE x.v IS DISTINCT FROM NEW.record->'receipts'->((x.n-1)::int)) THEN
    RAISE EXCEPTION 'Endpoint report history is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER endpoint_report_history_immutable BEFORE UPDATE ON socialgrowth_product.endpoint_report_journals
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_endpoint_report_history();
CREATE FUNCTION socialgrowth_product.guard_endpoint_report_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Endpoint report receipt is immutable';
END $$;
CREATE TRIGGER endpoint_report_receipt_immutable BEFORE UPDATE ON socialgrowth_product.endpoint_report_receipts
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_endpoint_report_receipt();
-- Retention/deletion and capacity are separate OPS policy, not silently supplied
-- by this additive migration or by in-memory fixture tests.
COMMIT;
