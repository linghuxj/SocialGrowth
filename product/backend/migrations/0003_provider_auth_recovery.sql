BEGIN;

ALTER TABLE socialgrowth_product.phone_verification_challenges
  ADD COLUMN verification_id uuid UNIQUE
  REFERENCES socialgrowth_product.phone_verifications(verification_id);

ALTER TABLE socialgrowth_product.phone_verification_challenges
  ADD CONSTRAINT phone_verification_challenges_verified_proof_pair
  CHECK (verification_id IS NULL OR verified_at IS NOT NULL) NOT VALID;

ALTER TABLE socialgrowth_product.phone_verification_challenges
  VALIDATE CONSTRAINT phone_verification_challenges_verified_proof_pair;

ALTER TABLE socialgrowth_product.provider_sessions
  ADD COLUMN phone_verification_id uuid UNIQUE
  REFERENCES socialgrowth_product.phone_verifications(verification_id);

COMMIT;
