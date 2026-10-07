BEGIN;
-- Initial transport is not Tailnet admission and grants no business readiness.
ALTER TABLE socialgrowth_product.device_connection_states
  DROP CONSTRAINT device_connection_states_authority_mode_check;
ALTER TABLE socialgrowth_product.device_connection_states
  ADD CONSTRAINT device_connection_states_authority_mode_check
  CHECK (authority_mode IN ('pilot_verified','formal_admitted','bootstrap','managed_verified'));

CREATE TABLE socialgrowth_product.bootstrap_management_bindings (
  device_id uuid PRIMARY KEY REFERENCES socialgrowth_product.devices(device_id),
  installation_id uuid NOT NULL REFERENCES socialgrowth_product.installations(installation_id),
  installation_generation bigint NOT NULL CHECK(installation_generation > 0),
  ownership_version bigint NOT NULL CHECK(ownership_version > 0),
  node_id text NOT NULL, node_key text NOT NULL, address text NOT NULL,
  hardware_serial text NOT NULL, verified_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

COMMIT;
