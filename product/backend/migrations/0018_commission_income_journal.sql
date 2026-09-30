BEGIN;
-- Internal reconciliation journal, not an actual receipt/ownership producer,
-- payable balance, authenticated public feed or payment system.
CREATE TABLE socialgrowth_product.commission_journal_guard (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton)
);
INSERT INTO socialgrowth_product.commission_journal_guard(singleton) VALUES(true);
CREATE TABLE socialgrowth_product.commission_income_sources (
  income_id uuid PRIMARY KEY,
  source_id uuid NOT NULL, source_record_id uuid NOT NULL,
  identity_id uuid NOT NULL, account_id uuid NOT NULL, platform text NOT NULL,
  current_revision bigint NOT NULL CHECK(current_revision BETWEEN 1 AND 9007199254740991),
  UNIQUE(source_id,source_record_id),
  FOREIGN KEY(identity_id,account_id,platform)
    REFERENCES socialgrowth_product.publishing_identities(identity_id,account_id,platform)
);
CREATE TABLE socialgrowth_product.commission_income_revisions (
  income_id uuid NOT NULL REFERENCES socialgrowth_product.commission_income_sources(income_id),
  revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  income jsonb NOT NULL, context jsonb NOT NULL, calculation jsonb NOT NULL,
  evaluated_at text NOT NULL,
  recorded_by_operator_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  PRIMARY KEY(income_id,revision),
  CHECK((jsonb_typeof(income)='object') IS TRUE),
  CHECK((income->>'incomeId'=income_id::text) IS TRUE),
  CHECK(((income->>'revision')::bigint=revision) IS TRUE),
  CHECK((jsonb_typeof(context)='object') IS TRUE),
  CHECK((jsonb_typeof(calculation)='object') IS TRUE),
  CHECK((calculation->>'incomeId'=income_id::text) IS TRUE),
  CHECK(((calculation->>'incomeRevision')::bigint=revision) IS TRUE),
  CHECK((calculation->>'stage'='internal_calculation_only') IS TRUE),
  CHECK((calculation->'paymentAllowed'='false'::jsonb) IS TRUE),
  CHECK((calculation->>'evaluatedAt'=evaluated_at) IS TRUE)
);
ALTER TABLE socialgrowth_product.commission_income_sources
  ADD CONSTRAINT commission_current_revision_exists
    FOREIGN KEY(income_id,current_revision) REFERENCES socialgrowth_product.commission_income_revisions(income_id,revision)
    DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE socialgrowth_product.commission_income_commands (
  actor_id uuid NOT NULL REFERENCES socialgrowth_product.operators(operator_id),
  request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  payload_digest bytea NOT NULL CHECK(octet_length(payload_digest)=32),
  income_id uuid NOT NULL REFERENCES socialgrowth_product.commission_income_sources(income_id),
  PRIMARY KEY(actor_id,request_key)
);
CREATE FUNCTION socialgrowth_product.guard_commission_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.income_id<>OLD.income_id OR NEW.source_id<>OLD.source_id OR NEW.source_record_id<>OLD.source_record_id
    OR NEW.identity_id<>OLD.identity_id OR NEW.account_id<>OLD.account_id OR NEW.platform<>OLD.platform
    OR NEW.current_revision<>OLD.current_revision+1 THEN
    RAISE EXCEPTION 'Commission source mapping is immutable; revisions must advance once';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commission_source_immutable BEFORE UPDATE ON socialgrowth_product.commission_income_sources
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_commission_source();
CREATE FUNCTION socialgrowth_product.guard_commission_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Commission revision history is immutable';
END $$;
CREATE TRIGGER commission_revision_immutable BEFORE UPDATE OR DELETE ON socialgrowth_product.commission_income_revisions
  FOR EACH ROW EXECUTE FUNCTION socialgrowth_product.guard_commission_revision();
-- Administrative integrity, retention and privileges are separate OPS work;
-- SQL triggers do not prove immutable storage against an unrestricted owner.
COMMIT;
