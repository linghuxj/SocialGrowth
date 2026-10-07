BEGIN;
ALTER TABLE socialgrowth_product.material_object_manifests ADD CONSTRAINT material_object_project_unique UNIQUE(object_id,project_id);
CREATE TABLE socialgrowth_product.material_upload_tickets(
  object_id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  descriptor jsonb NOT NULL CHECK(jsonb_typeof(descriptor)='object'),
  status text NOT NULL DEFAULT 'pending_bytes' CHECK(status IN('pending_bytes','verified_bytes')),
  prepared_by_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id), prepared_at text NOT NULL,
  verified_object_id uuid, verified_by_operator_id uuid REFERENCES socialgrowth_product.operators(operator_id), verified_at text,
  FOREIGN KEY(verified_object_id,project_id) REFERENCES socialgrowth_product.material_object_manifests(object_id,project_id),
  CHECK((descriptor->>'objectId'=object_id::text AND descriptor->>'projectId'=project_id::text) IS TRUE),
  CHECK((status='verified_bytes')=(verified_object_id IS NOT NULL AND verified_by_operator_id IS NOT NULL AND verified_at IS NOT NULL)),
  CHECK(status='verified_bytes' OR (verified_object_id IS NULL AND verified_by_operator_id IS NULL AND verified_at IS NULL)),
  CHECK(verified_object_id IS NULL OR verified_object_id=object_id)
);
CREATE TABLE socialgrowth_product.material_upload_commands(
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id), request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  kind text NOT NULL CHECK(kind IN('prepare','upload')), payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  object_id uuid NOT NULL REFERENCES socialgrowth_product.material_upload_tickets(object_id), PRIMARY KEY(actor_id,request_key)
);
CREATE FUNCTION socialgrowth_product.material_upload_advance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.object_id<>OLD.object_id OR NEW.project_id<>OLD.project_id OR NEW.descriptor<>OLD.descriptor
    OR NEW.prepared_by_operator_id<>OLD.prepared_by_operator_id OR NEW.prepared_at<>OLD.prepared_at
    OR OLD.status<>'pending_bytes' OR NEW.status<>'verified_bytes' THEN RAISE EXCEPTION 'Upload ticket cannot rebind or change completed bytes'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER material_upload_ticket_immutable BEFORE UPDATE ON socialgrowth_product.material_upload_tickets FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.material_upload_advance();
CREATE TRIGGER material_upload_ticket_no_delete BEFORE DELETE ON socialgrowth_product.material_upload_tickets FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.material_reject_change();
COMMIT;
