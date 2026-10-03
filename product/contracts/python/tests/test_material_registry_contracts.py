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
        row["declaration"].update(expectedApprovedDirectionId=None, expectedApprovedProjectVersion=None, contentRulesReviewed=False)
        row.update(languageTag="en-us", currentRevision=1, objects=[{"objectId": row["projectId"], "sha256": "a" * 64, "bytes": 10, "contentType": "video/mp4"}],
                   recordedAt="2026-10-01T00:00:00.123456789123Z", status="pending_validation", candidateAllowed=False, eligibilityReason="direction_not_approved", publicationAllowed=False)
        contracts.validate("materialCurrentView", row)
        contracts.validate("saveMaterialDeclarationResponse", {**row, "changed": True, "replayed": False})
        for patch in ({"key": "private"}, {"recordedByOperatorId": row["projectId"]}, {"revisions": []}, {"status": "approved"}, {"publicationAllowed": True},
                      {"objects": [{**row["objects"][0], "storageLocationId": row["projectId"]}]}, {"objects": [{**row["objects"][0], "contentType": "image/png"}]},
                      {"recordedAt": "0000-01-01T00:00:00Z"}, {"currentRevision": 0}):
            with self.assertRaises(ContractValidationError):
                contracts.validate("materialCurrentView", {**row, **patch})
        with self.assertRaises(ContractValidationError):
            contracts.validate("saveMaterialDeclarationResponse", {**row, "changed": True, "replayed": True})

    def current(self):
        row = self.request()
        for key in ("metadata", "expectedCurrentRevision", "objectIds"):
            row.pop(key)
        row["declaration"].update(expectedApprovedDirectionId=None, expectedApprovedProjectVersion=None, contentRulesReviewed=False)
        row.update(languageTag="en-us", currentRevision=2, objects=[{"objectId": row["projectId"], "sha256": "a" * 64, "bytes": 10, "contentType": "video/mp4"}],
                   recordedAt="2026-10-01T00:00:01.123456789123Z", status="pending_validation", candidateAllowed=False, eligibilityReason="direction_not_approved", publicationAllowed=False)
        return row

    def test_batch_trace_and_per_item_index_scope(self):
        contracts, request = FirstBatchContracts(), self.request()
        metadata = {"contractVersion": contracts.contract_version, "requestId": request["metadata"]["requestId"]}
        batch = {"metadata": metadata, "projectId": request["projectId"], "items": [None, {"malformed": True}, request]}
        contracts.validate("batchMaterialDeclarationsRequest", batch)
        for patch in ({"metadata": request["metadata"]}, {"items": [request] * 51}):
            with self.assertRaises(ContractValidationError):
                contracts.validate("batchMaterialDeclarationsRequest", {**batch, **patch})
        saved = {**self.current(), "changed": True, "replayed": False}
        rejected = {"index": 0, "outcome": "rejected", "error": {"code": "INPUT_INVALID", "message": "Fixed safe error", "retryable": False}}
        response = {"projectId": request["projectId"], "results": [rejected, {"index": 1, "outcome": "saved", "material": saved}]}
        contracts.validate("batchMaterialDeclarationsResponse", response)
        for patch in ({"allSaved": True}, {"results": [{**rejected, "index": 1}]}, {"results": [{"index": 0, "outcome": "saved", "material": {**saved, "projectId": "b0000000-0000-4000-8000-000000000001"}}]}):
            with self.assertRaises(ContractValidationError):
                contracts.validate("batchMaterialDeclarationsResponse", {**response, **patch})

    def test_history_numeric_cursor_time_and_current_consistency(self):
        contracts, row = FirstBatchContracts(), self.current()
        contracts.validate("materialHistoryQuery", {"afterRevision": 0, "pageSize": 50})
        with self.assertRaises(ContractValidationError):
            contracts.validate("materialHistoryQuery", {"afterRevision": 1001, "pageSize": 51})
        revision = {"revision": 1, "declaration": row["declaration"], "objects": row["objects"], "recordedAt": "2026-10-01T00:00:00.123456789123Z", "status": row["status"]}
        page = {"current": row, "revisions": [revision], "nextAfterRevision": 1}
        contracts.validate("materialHistoryResponse", page)
        contracts.validate("materialHistoryResponse", {"current": row, "revisions": [{**revision, "revision": 2, "recordedAt": row["recordedAt"]}], "nextAfterRevision": None})
        for patch in ({"nextAfterRevision": None}, {"revisions": [{**revision, "recordedAt": "2026-10-01T00:00:01.123456789124Z"}]},
                      {"revisions": [{**revision, "objects": [{**revision["objects"][0], "contentType": "image/png"}]}]},
                      {"revisions": [revision, {**revision, "revision": 3}], "nextAfterRevision": None}, {"revisions": [{**revision, "revision": 2}], "nextAfterRevision": None}):
            with self.assertRaises(ContractValidationError):
                contracts.validate("materialHistoryResponse", {**page, **patch})

    def test_library_scope_order_and_cursor(self):
        contracts, first = FirstBatchContracts(), self.current()
        contracts.validate("materialLibraryQuery", {"afterVariantId": None, "pageSize": 50})
        with self.assertRaises(ContractValidationError):
            contracts.validate("materialLibraryQuery", {"afterVariantId": first["variantId"], "pageSize": 51})
        second = {**first, "variantId": "a0000000-0000-4000-8000-000000000002", "languageTag": "zh-cn"}
        page = {"projectId": first["projectId"], "materials": [first, second], "nextAfterVariantId": second["variantId"]}
        contracts.validate("materialLibraryResponse", page)
        contracts.validate("materialLibraryResponse", {"projectId": first["projectId"], "materials": [], "nextAfterVariantId": None})
        for patch in ({"nextAfterVariantId": first["variantId"]}, {"materials": [second, first], "nextAfterVariantId": None}, {"materials": [first, first], "nextAfterVariantId": None},
                      {"materials": [{**first, "projectId": "b0000000-0000-4000-8000-000000000001"}], "nextAfterVariantId": None}, {"materials": [], "nextAfterVariantId": first["variantId"]}):
            with self.assertRaises(ContractValidationError):
                contracts.validate("materialLibraryResponse", {**page, **patch})
