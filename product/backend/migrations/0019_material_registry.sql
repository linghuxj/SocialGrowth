BEGIN;
-- Human declarations and pinned object manifests only, never candidate grants.
CREATE TABLE socialgrowth_product.material_registry_guard(singleton boolean PRIMARY KEY CHECK(singleton));
INSERT INTO socialgrowth_product.material_registry_guard VALUES(true);
CREATE TABLE socialgrowth_product.material_content_units(
  content_unit_id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  source_id uuid NOT NULL, source_record_id uuid NOT NULL,
  identity jsonb NOT NULL CHECK(jsonb_typeof(identity)='object'),
  UNIQUE(source_id,source_record_id), UNIQUE(content_unit_id,project_id)
);
CREATE TABLE socialgrowth_product.material_variants(
  variant_id uuid PRIMARY KEY, content_unit_id uuid NOT NULL, project_id uuid NOT NULL,
  language_tag text NOT NULL CHECK(language_tag ~ '^[a-z]{2,8}(-[a-z0-9]{1,8})*$'),
  current_revision bigint NOT NULL CHECK(current_revision BETWEEN 1 AND 1000),
  FOREIGN KEY(content_unit_id,project_id) REFERENCES socialgrowth_product.material_content_units(content_unit_id,project_id),
  UNIQUE(content_unit_id,language_tag)
);
CREATE TABLE socialgrowth_product.material_object_manifests(
  object_id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  reference jsonb NOT NULL CHECK(jsonb_typeof(reference)='object'),
  CHECK((reference->>'objectId'=object_id::text AND reference->>'projectId'=project_id::text) IS TRUE)
);
CREATE TABLE socialgrowth_product.material_variant_revisions(
  variant_id uuid NOT NULL REFERENCES socialgrowth_product.material_variants(variant_id), revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 1000),
  declaration jsonb NOT NULL CHECK(jsonb_typeof(declaration)='object'),
  object_references jsonb NOT NULL CHECK(jsonb_typeof(object_references)='array' AND jsonb_array_length(object_references) BETWEEN 1 AND 20),
  status text NOT NULL DEFAULT 'pending_validation' CHECK(status='pending_validation'),
  recorded_by_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  recorded_at text NOT NULL,
  PRIMARY KEY(variant_id,revision)
);
ALTER TABLE socialgrowth_product.material_variants ADD CONSTRAINT material_current_revision_fk
  FOREIGN KEY(variant_id,current_revision) REFERENCES socialgrowth_product.material_variant_revisions(variant_id,revision) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE socialgrowth_product.material_registry_commands(
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id), request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32), variant_id uuid NOT NULL REFERENCES socialgrowth_product.material_variants(variant_id),
  PRIMARY KEY(actor_id,request_key)
);
CREATE FUNCTION socialgrowth_product.material_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Material history and identity are immutable'; END $$;
CREATE TRIGGER material_unit_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.material_content_units FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.material_reject_change();
CREATE TRIGGER material_object_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.material_object_manifests FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.material_reject_change();
CREATE TRIGGER material_revision_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.material_variant_revisions FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.material_reject_change();
CREATE FUNCTION socialgrowth_product.material_variant_advance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.variant_id,NEW.content_unit_id,NEW.project_id,NEW.language_tag) IS DISTINCT FROM (OLD.variant_id,OLD.content_unit_id,OLD.project_id,OLD.language_tag)
    OR NEW.current_revision<>OLD.current_revision+1 THEN RAISE EXCEPTION 'Material variant cannot rebind or skip revision'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER material_variant_immutable BEFORE UPDATE ON socialgrowth_product.material_variants FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.material_variant_advance();
COMMIT;
