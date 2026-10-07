BEGIN;
-- Historical observations retain their original project after an idle account
-- is reused. Current reservations are checked by the trusted ingestion path;
-- they are not the identity of an already-recorded immutable observation.
ALTER TABLE socialgrowth_product.metric_snapshot_report_heads
  DROP CONSTRAINT metric_snapshot_report_heads_account_id_project_id_fkey;
ALTER TABLE socialgrowth_product.metric_snapshot_history
  DROP CONSTRAINT metric_snapshot_history_account_id_project_id_fkey;
ALTER TABLE socialgrowth_product.metric_snapshot_history
  ADD CONSTRAINT metric_snapshot_history_project_id_fkey FOREIGN KEY(project_id)
  REFERENCES socialgrowth_product.projects(project_id);
-- Both tables already reference the immutable publishing identity/account
-- relationship. Report heads also retain their existing project foreign key.
COMMIT;
