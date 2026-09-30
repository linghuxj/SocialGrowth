import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from socialgrowth_contracts import FirstBatchContracts, ContractValidationError


class MaterialRegistryContractsTest(unittest.TestCase):
    def request(self):
        identifier = "a0000000-0000-4000-8000-000000000001"
        return {"metadata": {"contractVersion": FirstBatchContracts().contract_version, "requestId": "request-material", "idempotencyKey": "idempotency-material"},
                "projectId": identifier, "contentUnitId": identifier, "sourceId": identifier, "sourceRecordId": identifier, "variantId": identifier,
                "languageTag": "en-US", "expectedCurrentRevision": 0, "objectIds": [identifier],
                "identity": {"mediaKind": "video", "businessKind": "product", "businessEntityId": identifier, "seriesId": None, "episodeNumber": None},
                "declaration": {"name": "Synthetic", "description": "Explicit description", "businessFacts": "Explicit facts", "sourceStatement": "Explicit source",
                                "sourceEvidenceIds": [identifier], "firstUseDeclaration": "declared_not_previously_published"}}

    def test_request_explicit_identity_duplicates_and_text(self):
        contracts, row = FirstBatchContracts(), self.request()
        contracts.validate("saveMaterialDeclarationRequest", row)
        identifier = row["projectId"]
        for patch in ({"actorId": identifier}, {"endpoint": "https://fixture.invalid"}, {"candidateAllowed": True}, {"objectIds": [identifier, identifier.upper()]},
                      {"identity": {**row["identity"], "seriesId": identifier}}, {"identity": {**row["identity"], "seriesId": identifier, "episodeNumber": 1}},
                      {"declaration": {**row["declaration"], "sourceEvidenceIds": [identifier, identifier.upper()]}},
                      {"declaration": {**row["declaration"], "name": "\ufeffSynthetic"}}, {"declaration": {**row["declaration"], "businessFacts": "line\nfeed"}},
                      {"declaration": {**row["declaration"], "name": "😀" * 151}}):
            with self.assertRaises(ContractValidationError):
                contracts.validate("saveMaterialDeclarationRequest", {**row, **patch})
        contracts.validate("saveMaterialDeclarationRequest", {**row, "identity": {**row["identity"], "businessKind": "drama", "seriesId": identifier, "episodeNumber": 1}})
        contracts.validate("saveMaterialDeclarationRequest", {**row, "declaration": {**row["declaration"], "name": "😀" * 150}})

    def test_current_projection_pending_and_locator_boundaries(self):
        contracts, row = FirstBatchContracts(), self.request()
        for key in ("metadata", "expectedCurrentRevision", "objectIds"):
            row.pop(key)
        row.update(languageTag="en-us", currentRevision=1, objects=[{"objectId": row["projectId"], "sha256": "a" * 64, "bytes": 10, "contentType": "video/mp4"}],
                   recordedAt="2026-10-01T00:00:00.123456789123Z", status="pending_validation", candidateAllowed=False, publicationAllowed=False)
        contracts.validate("materialCurrentView", row)
        contracts.validate("saveMaterialDeclarationResponse", {**row, "changed": True, "replayed": False})
        for patch in ({"key": "private"}, {"recordedByOperatorId": row["projectId"]}, {"revisions": []}, {"status": "approved"}, {"publicationAllowed": True},
                      {"objects": [{**row["objects"][0], "storageLocationId": row["projectId"]}]}, {"objects": [{**row["objects"][0], "contentType": "image/png"}]},
                      {"recordedAt": "0000-01-01T00:00:00Z"}, {"currentRevision": 0}):
            with self.assertRaises(ContractValidationError):
                contracts.validate("materialCurrentView", {**row, **patch})
        with self.assertRaises(ContractValidationError):
            contracts.validate("saveMaterialDeclarationResponse", {**row, "changed": True, "replayed": True})
