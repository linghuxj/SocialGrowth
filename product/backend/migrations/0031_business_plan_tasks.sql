BEGIN;
-- Current-scope plan candidates only. These rows are not execution commands.
CREATE TABLE socialgrowth_product.business_plan_guard(singleton boolean PRIMARY KEY CHECK(singleton));
INSERT INTO socialgrowth_product.business_plan_guard VALUES(true);

CREATE TABLE socialgrowth_product.business_plan_records(
  project_id uuid PRIMARY KEY REFERENCES socialgrowth_product.projects(project_id),
  current_revision bigint NOT NULL DEFAULT 0 CHECK(current_revision BETWEEN 0 AND 9007199254740991),
  plan_id uuid,
  CHECK((current_revision=0)=(plan_id IS NULL)),
  UNIQUE(project_id,plan_id)
);
CREATE TABLE socialgrowth_product.business_plan_revisions(
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  plan_id uuid NOT NULL,
  project_version bigint NOT NULL CHECK(project_version BETWEEN 0 AND 9007199254740991),
  approval_id uuid NOT NULL REFERENCES socialgrowth_product.project_direction_approvals(approval_id),
  window_start text NOT NULL CHECK(window_start !~ '^0000-'),
  window_end text NOT NULL CHECK(window_end !~ '^0000-'),
  outcome text NOT NULL CHECK(outcome IN ('planned','unchanged','insufficient_data','direction_confirmation_required')),
  suggestion jsonb NOT NULL CHECK(jsonb_typeof(suggestion)='object'),
  quota_snapshot jsonb NOT NULL CHECK(jsonb_typeof(quota_snapshot)='object'),
  recorded_by_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(project_id,revision),
  UNIQUE(project_id,revision,plan_id),
  FOREIGN KEY(project_id,plan_id) REFERENCES socialgrowth_product.business_plan_records(project_id,plan_id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE socialgrowth_product.business_plan_records ADD CONSTRAINT business_plan_current_fk
  FOREIGN KEY(project_id,current_revision,plan_id) REFERENCES socialgrowth_product.business_plan_revisions(project_id,revision,plan_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE socialgrowth_product.business_plan_tasks(
  task_id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  plan_revision bigint NOT NULL CHECK(plan_revision BETWEEN 1 AND 9007199254740991),
  task_revision bigint NOT NULL DEFAULT 1 CHECK(task_revision BETWEEN 1 AND 1000),
  content_unit_id uuid NOT NULL REFERENCES socialgrowth_product.material_content_units(content_unit_id),
  variant_id uuid NOT NULL REFERENCES socialgrowth_product.material_variants(variant_id),
  material_revision bigint NOT NULL CHECK(material_revision BETWEEN 1 AND 1000),
  identity_id uuid NOT NULL REFERENCES socialgrowth_product.publishing_identities(identity_id),
  platform text NOT NULL CHECK(platform IN ('facebook','youtube')),
  form text NOT NULL CHECK(form IN ('facebook_video','facebook_image_text','youtube_shorts','youtube_video')),
  language_tag text NOT NULL CHECK(language_tag ~ '^[a-z]{2,8}(-[a-z0-9]{1,8})*$'),
  scheduled_at text NOT NULL CHECK(scheduled_at !~ '^0000-'),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 4000),
  caption text NOT NULL CHECK(length(caption) BETWEEN 1 AND 4000),
  state text NOT NULL DEFAULT 'pending_current_checks' CHECK(state='pending_current_checks'),
  execution_allowed boolean NOT NULL DEFAULT false CHECK(NOT execution_allowed),
  publication_allowed boolean NOT NULL DEFAULT false CHECK(NOT publication_allowed),
  recorded_by_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(project_id,plan_revision,plan_id) REFERENCES socialgrowth_product.business_plan_revisions(project_id,revision,plan_id),
  UNIQUE(content_unit_id,platform),
  UNIQUE(project_id,task_id),
  CHECK((form LIKE 'facebook_%' AND platform='facebook') OR (form LIKE 'youtube_%' AND platform='youtube'))
);
CREATE TABLE socialgrowth_product.business_plan_outbox(
  message_id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  task_id uuid NOT NULL UNIQUE,
  purpose text NOT NULL DEFAULT 'current_check_reference' CHECK(purpose='current_check_reference'),
  state text NOT NULL DEFAULT 'pending_current_checks' CHECK(state='pending_current_checks'),
  execution_allowed boolean NOT NULL DEFAULT false CHECK(NOT execution_allowed),
  publication_allowed boolean NOT NULL DEFAULT false CHECK(NOT publication_allowed),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(project_id,task_id) REFERENCES socialgrowth_product.business_plan_tasks(project_id,task_id)
);
CREATE TABLE socialgrowth_product.business_plan_commands(
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  project_id uuid NOT NULL REFERENCES socialgrowth_product.projects(project_id),
  response jsonb NOT NULL CHECK(jsonb_typeof(response)='object'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(actor_id,request_key)
);
CREATE FUNCTION socialgrowth_product.business_plan_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Business plan history is immutable'; END $$;
CREATE TRIGGER business_plan_revision_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.business_plan_revisions FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.business_plan_immutable();
CREATE TRIGGER business_plan_task_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.business_plan_tasks FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.business_plan_immutable();
COMMIT;
