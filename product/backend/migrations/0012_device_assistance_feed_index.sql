BEGIN;
CREATE INDEX device_assistance_todos_feed_idx ON socialgrowth_product.device_assistance_todos(created_at,todo_id);
-- Opaque todo cursor: retain the full DB timestamp, never round via JS Date.
COMMIT;
