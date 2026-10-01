import base64
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from socialgrowth_contracts import FirstBatchContracts, ContractValidationError


class MediaCredentialContractsTest(unittest.TestCase):
    def setUp(self):
        self.contracts = FirstBatchContracts()
        self.identity = "a0000000-0000-4000-8000-000000000001"
        self.command = {"metadata": {"contractVersion": "2026-09-29.identity-v1",
                                     "requestId": "request-credential", "idempotencyKey": "credential_intent_1"},
                        "credentialId": self.identity, "accountId": self.identity, "platform": "facebook",
                        "expectedRevision": 0, "operation": "put", "payloadBase64": "AA=="}

    def test_canonical_ascii_bytes_limit_matches_ts_not_secret_unicode_length(self):
        for size in (1, 2, 3, 8190, 8191, 8192):
            self.contracts.validate("writeMediaCredentialRequest", {**self.command, "payloadBase64": base64.b64encode(bytes([255]) * size).decode("ascii")})
        for value in ("", "AA", "AB==", "AAB=", "AA===", "AA==\n", "秘密",
                      base64.b64encode(bytes(8193)).decode("ascii")):
            with self.assertRaises(ContractValidationError):
                self.contracts.validate("writeMediaCredentialRequest", {**self.command, "payloadBase64": value})
        without = {key: value for key, value in self.command.items() if key != "payloadBase64"}
        self.contracts.validate("writeMediaCredentialRequest", {**without, "operation": "invalidate"})
        for patch in ({"accountId": self.identity.upper()}, {"credentialId": self.identity + "\n"},
                      {"expectedRevision": 9007199254740992}, {"actionPermissionGranted": True},
                      {"password": "forbidden"}, {"operation": "invalidate"}):
            with self.assertRaises(ContractValidationError):
                self.contracts.validate("writeMediaCredentialRequest", {**self.command, **patch})

    def test_strict_current_metadata_and_only_three_replay_combinations(self):
        credential = {"credentialId": self.identity, "accountId": self.identity, "platform": "facebook",
                      "revision": 1, "state": "stored_unverified", "actionPermissionGranted": False,
                      "acceptanceStarted": False}
        self.contracts.validate("readMediaCredentialResponse", {"contractVersion": "2026-09-29.identity-v1", "credential": None})
        for changed, replayed in ((True, False), (False, False), (False, True)):
            self.contracts.validate("writeMediaCredentialResponse", {"contractVersion": "2026-09-29.identity-v1",
                                    "credential": credential, "changed": changed, "replayed": replayed})
        with self.assertRaises(ContractValidationError):
            self.contracts.validate("writeMediaCredentialResponse", {"contractVersion": "2026-09-29.identity-v1",
                                    "credential": credential, "changed": True, "replayed": True})
        for patch in ({"password": "forbidden"}, {"envelope": {}}, {"state": "ready"}, {"revision": 0},
                      {"acceptanceStarted": True}):
            with self.assertRaises(ContractValidationError):
                self.contracts.validate("mediaCredentialMetadata", {**credential, **patch})


if __name__ == "__main__":
    unittest.main()
