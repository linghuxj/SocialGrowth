BEGIN;
CREATE INDEX device_assistance_notes_cursor_idx ON socialgrowth_product.device_assistance_notes(todo_id,recorded_at,note_id);
COMMIT;
