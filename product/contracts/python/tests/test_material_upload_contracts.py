import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from socialgrowth_contracts import FirstBatchContracts, ContractValidationError


class MaterialUploadContractsTest(unittest.TestCase):
    def test_inventory_nested_status_project_order_and_cursor(self):
        contracts, first = FirstBatchContracts(), self.row()
        second = {**first, "objectId": "a0000000-0000-4000-8000-000000000002", "status": "verified_bytes", "verifiedAt": first["preparedAt"]}
        page = {"projectId": first["projectId"], "tickets": [first, second], "nextAfterObjectId": second["objectId"]}
        contracts.validate("materialUploadInventoryQuery", {"afterObjectId": None, "pageSize": 50})
        contracts.validate("materialUploadInventoryResponse", page)
        contracts.validate("materialUploadInventoryResponse", {**page, "tickets": [], "nextAfterObjectId": None})
        for size in (0, 51, True, 1.2):
            with self.assertRaises(ContractValidationError):
                contracts.validate("materialUploadInventoryQuery", {"afterObjectId": None, "pageSize": size})
        for patch in ({"tickets": [second, first], "nextAfterObjectId": None}, {"tickets": [first, first], "nextAfterObjectId": None},
                      {"nextAfterObjectId": first["objectId"]}, {"tickets": [], "nextAfterObjectId": first["objectId"]},
                      {"tickets": [{**first, "projectId": second["objectId"]}], "nextAfterObjectId": None},
                      {"tickets": [{**first, "status": "verified_bytes"}], "nextAfterObjectId": None},
                      {"tickets": [{**second, "verifiedAt": "2026-10-01T00:00:00.123456789122Z"}], "nextAfterObjectId": None},
                      {"tickets": [{**first, "key": "private"}], "nextAfterObjectId": None}, {"tickets": [{**first, "candidateAllowed": True}], "nextAfterObjectId": None}):
            with self.assertRaises(ContractValidationError):
                contracts.validate("materialUploadInventoryResponse", {**page, **patch})

    def row(self):
        identifier = "a0000000-0000-4000-8000-000000000001"
        return {"projectId": identifier, "objectId": identifier, "sha256": "a" * 64, "bytes": 12,
                "contentType": "video/mp4", "status": "pending_bytes", "preparedAt": "2026-10-01T00:00:00.123456789123Z",
                "verifiedAt": None, "candidateAllowed": False, "publicationAllowed": False}

    def test_minimal_status_and_locator(self):
        contracts = FirstBatchContracts()
        row = self.row()
        contracts.validate("materialUploadTicketView", row)
        for patch in ({"candidateAllowed": True}, {"publicationAllowed": True}, {"key": "secret-locator"},
                      {"descriptor": {}}, {"status": "verified_bytes"}, {"preparedAt": "0000-01-01T00:00:00Z"}):
            with self.assertRaises(ContractValidationError):
                contracts.validate("materialUploadTicketView", {**row, **patch})

    def test_exact_fraction_and_result_consistency(self):
        contracts = FirstBatchContracts()
        row = {**self.row(), "status": "verified_bytes", "verifiedAt": "2026-10-01T08:00:00.123456789123+08:00"}
        contracts.validate("materialUploadTicketView", row)
        with self.assertRaises(ContractValidationError):
            contracts.validate("materialUploadTicketView", {**row, "verifiedAt": "2026-10-01T00:00:00.123456789122Z"})
        contracts.validate("prepareMaterialUploadResponse", {**row, "changed": False, "replayed": True})
        with self.assertRaises(ContractValidationError):
            contracts.validate("prepareMaterialUploadResponse", {**row, "changed": True, "replayed": True})

    def test_byte_transport_acknowledgement_is_not_pending_or_permission(self):
        contracts = FirstBatchContracts()
        row = {**self.row(), "status": "verified_bytes", "verifiedAt": "2026-10-01T00:00:01Z", "changed": True, "replayed": False}
        contracts.validate("uploadMaterialBytesResponse", row)
        for patch in ({"status": "pending_bytes", "verifiedAt": None}, {"publicationAllowed": True}, {"replayed": True}):
            with self.assertRaises(ContractValidationError):
                contracts.validate("uploadMaterialBytesResponse", {**row, **patch})
