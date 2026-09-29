BEGIN;

CREATE TABLE socialgrowth_product.phone_verification_challenges (
  challenge_id uuid PRIMARY KEY,
  phone_e164 text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('provider_registration', 'provider_login')),
  provider_id uuid REFERENCES socialgrowth_product.providers(provider_id),
  code_digest bytea NOT NULL,
  delivery_state text NOT NULL CHECK (delivery_state IN ('pending', 'accepted', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 5),
  idempotency_key text NOT NULL,
  request_digest bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  resend_available_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  UNIQUE (purpose, phone_e164, idempotency_key),
  CHECK (phone_e164 ~ '^[+][1-9][0-9]{7,14}$'),
  CHECK (expires_at > created_at),
  CHECK (resend_available_at >= created_at),
  CHECK (resend_available_at <= expires_at),
  CHECK (verified_at IS NULL OR delivery_state = 'accepted'),
  CHECK (verified_at IS NULL OR verified_at >= created_at),
  CHECK (verified_at IS NULL OR verified_at <= expires_at),
  CHECK (
    (purpose = 'provider_registration' AND provider_id IS NULL)
    OR (purpose = 'provider_login' AND provider_id IS NOT NULL)
  )
);

CREATE INDEX phone_verification_challenges_rate_limit_idx
  ON socialgrowth_product.phone_verification_challenges(phone_e164, created_at DESC);

COMMIT;
