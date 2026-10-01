import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from socialgrowth_contracts import FirstBatchContracts, ContractValidationError


class ResourcePreparationContractsTest(unittest.TestCase):
    def registration(self):
        identifier = "a0000000-0000-4000-8000-000000000001"
        return {"accountId": identifier, "identityId": identifier, "platform": "facebook",
                "canonicalAccountRef": "operator_declared_login", "canonicalIdentityRef": "operator_declared_page"}

    def test_strict_declarations_and_original_key_format(self):
        c = FirstBatchContracts()
        row = {"metadata": {"contractVersion": c.contract_version, "requestId": "request-resources", "idempotencyKey": "resource_preparation_key"},
               "expectedResourceVersion": 0, "registration": self.registration()}
        c.validate("registerMediaIdentityRequest", row)
        for patch in ({"actorId": row["registration"]["accountId"]}, {"registration": {**row["registration"], "password": "never-accepted"}},
                      {"registration": {**row["registration"], "canonicalIdentityRef": "https://fixture.invalid/page"}},
                      {"registration": {**row["registration"], "identityId": row["registration"]["identityId"].upper()}},
                      {"metadata": {**row["metadata"], "idempotencyKey": "has space key--000"}}, {"expectedResourceVersion": 9007199254740992}):
            with self.assertRaises(ContractValidationError):
                c.validate("registerMediaIdentityRequest", {**row, **patch})
        for field in ("accountId", "identityId", "canonicalAccountRef", "canonicalIdentityRef"):
            with self.assertRaises(ContractValidationError):
                c.validate("registerMediaIdentityRequest", {**row, "registration": {**row["registration"], field: row["registration"][field] + "\n"}})
        with self.assertRaises(ContractValidationError):
            c.validate("registerMediaIdentityRequest", {**row, "metadata": {**row["metadata"], "idempotencyKey": row["metadata"]["idempotencyKey"] + "\n"}})

    def test_registration_always_unverified_and_changed_replay_rejected(self):
        c = FirstBatchContracts()
        row = {"contractVersion": c.contract_version, "version": 1, "registration": self.registration(), "changed": True, "replayed": False,
               "state": "registered_unverified", "actionPermissionGranted": False, "acceptanceStarted": False}
        c.validate("registerMediaIdentityResponse", row)
        c.validate("registerMediaIdentityResponse", {**row, "changed": False, "replayed": True})
        for patch in ({"state": "verified"}, {"replayed": True}, {"actionPermissionGranted": True}, {"acceptanceStarted": True}, {"credential": "forbidden"}):
            with self.assertRaises(ContractValidationError):
                c.validate("registerMediaIdentityResponse", {**row, **patch})

    def test_resource_preparation_is_not_execution_or_acceptance(self):
        c = FirstBatchContracts()
        identifier = self.registration()["identityId"]
        request = {"metadata": {"contractVersion": c.contract_version, "requestId": "request-resources", "idempotencyKey": "resource_preparation_key"},
                   "expectedResourceVersion": 0, "expectedProjectVersion": 0, "expectedDeviceVersion": 0,
                   "reservation": {"projectId": identifier, "deviceId": identifier, "identityIds": [identifier]}}
        c.validate("reserveResourcePreparationRequest", request)
        for patch in ({"ready": True}, {"expectedDeviceVersion": -1}, {"reservation": {**request["reservation"], "identityIds": []}}):
            with self.assertRaises(ContractValidationError):
                c.validate("reserveResourcePreparationRequest", {**request, **patch})
        row = {"contractVersion": c.contract_version, "version": 0, "replayed": False, "actionPermissionGranted": False, "acceptanceStarted": False,
               "snapshot": {"accounts": [], "identities": [], "phones": [], "accountUses": [], "bindings": []}}
        c.validate("resourcePreparationResponse", row)
        for patch in ({"actionPermissionGranted": True}, {"acceptanceStarted": True}, {"acceptedAt": "2026-10-01T00:00:00Z"}):
            with self.assertRaises(ContractValidationError):
                c.validate("resourcePreparationResponse", {**row, **patch})
