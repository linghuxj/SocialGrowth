BEGIN;
-- Internal assistance journal only; no task resume/permission or sender worker.
ALTER TABLE socialgrowth_product.device_associations
  ADD CONSTRAINT device_associations_todo_authority_unique UNIQUE(association_id,device_id,provider_id);
CREATE TABLE socialgrowth_product.device_assistance_todos (
  todo_id uuid PRIMARY KEY,
  occurrence_id uuid NOT NULL,
  provider_id uuid NOT NULL REFERENCES socialgrowth_product.providers(provider_id),
  initial_responsible_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  kind text NOT NULL DEFAULT 'network_access_help' CHECK(kind='network_access_help'),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','awaiting_recheck')),
  fact_version bigint NOT NULL DEFAULT 0 CHECK(fact_version BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(updated_at>=created_at),
  UNIQUE(provider_id,occurrence_id), UNIQUE(todo_id,provider_id)
);
CREATE TABLE socialgrowth_product.device_assistance_impacts (
  todo_id uuid NOT NULL, provider_id uuid NOT NULL,
  device_id uuid NOT NULL, association_id uuid NOT NULL,
  recorded_device_version bigint NOT NULL CHECK(recorded_device_version BETWEEN 0 AND 9007199254740991),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(todo_id,device_id),
  FOREIGN KEY(todo_id,provider_id) REFERENCES socialgrowth_product.device_assistance_todos(todo_id,provider_id),
  FOREIGN KEY(association_id,device_id,provider_id) REFERENCES socialgrowth_product.device_associations(association_id,device_id,provider_id)
);
CREATE TABLE socialgrowth_product.device_assistance_events (
  event_id uuid PRIMARY KEY,
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  todo_id uuid NOT NULL REFERENCES socialgrowth_product.device_assistance_todos(todo_id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE socialgrowth_product.device_assistance_notes (
  note_id uuid PRIMARY KEY,
  todo_id uuid NOT NULL REFERENCES socialgrowth_product.device_assistance_todos(todo_id),
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  kind text NOT NULL CHECK(kind IN ('note','reported_processed')),
  text text NOT NULL CHECK(length(text) BETWEEN 1 AND 150 AND text=btrim(text)),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE socialgrowth_product.device_assistance_commands (
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL CHECK(length(request_key) BETWEEN 16 AND 128),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  todo_id uuid NOT NULL REFERENCES socialgrowth_product.device_assistance_todos(todo_id),
  PRIMARY KEY(actor_id,request_key)
);
CREATE TABLE socialgrowth_product.device_assistance_notification_intents (
  todo_id uuid PRIMARY KEY REFERENCES socialgrowth_product.device_assistance_todos(todo_id),
  status text NOT NULL DEFAULT 'awaiting_configuration' CHECK(status='awaiting_configuration'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- No email address exists on the current operator model. Keep a single durable
-- intent, never fabricate a recipient, send result, resolved state or project.
COMMIT;
