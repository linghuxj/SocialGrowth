BEGIN;
-- Source documents are deferred for current clip testing. Preserve missing
-- values as NULL instead of fabricating source identities or proof records.
ALTER TABLE socialgrowth_product.material_content_units ALTER COLUMN source_id DROP NOT NULL;
ALTER TABLE socialgrowth_product.material_content_units ALTER COLUMN source_record_id DROP NOT NULL;
COMMIT;
