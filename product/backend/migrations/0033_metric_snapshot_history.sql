BEGIN;
-- Account-level source-report snapshots only. Content attribution remains
-- closed until a trusted publication/task receipt producer exists.
CREATE TABLE socialgrowth_product.metric_snapshot_report_heads(
  source_id uuid NOT NULL,
  source_report_id uuid NOT NULL,
  account_id uuid NOT NULL,
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  identity_id uuid NOT NULL,
  platform text NOT NULL CHECK(platform IN ('facebook','youtube')),
  definition_id uuid NOT NULL,
  measurement text NOT NULL CHECK(measurement IN ('cumulative','interval')),
  current_revision bigint NOT NULL DEFAULT 0 CHECK(current_revision BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(source_id,source_report_id),
  FOREIGN KEY(account_id,platform) REFERENCES socialgrowth_product.media_accounts(account_id,platform),
  FOREIGN KEY(identity_id,account_id,platform) REFERENCES socialgrowth_product.publishing_identities(identity_id,account_id,platform),
  FOREIGN KEY(account_id,project_id) REFERENCES socialgrowth_product.project_account_reservations(account_id,project_id),
  CHECK(updated_at>=created_at)
);

CREATE TABLE socialgrowth_product.metric_snapshot_history(
  snapshot_id uuid PRIMARY KEY,
  source_id uuid NOT NULL,
  source_report_id uuid NOT NULL,
  revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  account_id uuid NOT NULL,
  project_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  platform text NOT NULL CHECK(platform IN ('facebook','youtube')),
  definition_id uuid NOT NULL,
  measurement text NOT NULL CHECK(measurement IN ('cumulative','interval')),
  subject_kind text NOT NULL DEFAULT 'account' CHECK(subject_kind='account'),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(source_id,source_report_id,revision),
  FOREIGN KEY(source_id,source_report_id) REFERENCES socialgrowth_product.metric_snapshot_report_heads(source_id,source_report_id),
  FOREIGN KEY(account_id,project_id) REFERENCES socialgrowth_product.project_account_reservations(account_id,project_id),
  FOREIGN KEY(identity_id,account_id,platform) REFERENCES socialgrowth_product.publishing_identities(identity_id,account_id,platform)
);
CREATE INDEX metric_snapshot_history_scope_idx ON socialgrowth_product.metric_snapshot_history(project_id,identity_id,recorded_at DESC);

CREATE FUNCTION socialgrowth_product.metric_snapshot_reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Metric snapshot history is immutable'; END $$;
CREATE TRIGGER metric_snapshot_history_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.metric_snapshot_history
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.metric_snapshot_reject_history_change();
CREATE FUNCTION socialgrowth_product.metric_snapshot_guard_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Metric report head cannot be deleted'; END IF;
  IF NEW.source_id IS DISTINCT FROM OLD.source_id OR NEW.source_report_id IS DISTINCT FROM OLD.source_report_id
    OR NEW.account_id IS DISTINCT FROM OLD.account_id OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.identity_id IS DISTINCT FROM OLD.identity_id OR NEW.platform IS DISTINCT FROM OLD.platform
    OR NEW.definition_id IS DISTINCT FROM OLD.definition_id OR NEW.measurement IS DISTINCT FROM OLD.measurement
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.current_revision<>OLD.current_revision+1
    OR NEW.updated_at<OLD.updated_at THEN RAISE EXCEPTION 'Metric report head scope or revision is invalid'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER metric_snapshot_head_guard BEFORE UPDATE OR DELETE ON socialgrowth_product.metric_snapshot_report_heads
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.metric_snapshot_guard_head();
COMMIT;
