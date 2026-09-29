package com.socialgrowth.product

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class FirstBatchContractBoundaryTest {
    private val id = "00000000-0000-4000-8000-000000000001"

    @Test
    fun acceptsCurrentVersionAndConsistentInstallationState() {
        val qr = FirstBatchContractBoundary.parseAssociationQrPayload(
            """{"contractVersion":"${GeneratedFirstBatchContractSpec.CONTRACT_VERSION}","associationCode":"sgassoc_v1_${"A".repeat(43)}"}""",
        )
        assertEquals(GeneratedFirstBatchContractSpec.CONTRACT_VERSION, qr.contractVersion)

        val view = FirstBatchContractBoundary.parseInstallationSelfView(
            """{"factVersion":1,"updatedAt":"2026-09-29T00:00:00Z","installationId":"$id","state":"unassociated","deviceId":null}""",
        )
        assertEquals("unassociated", view.state)

        val preciseView = FirstBatchContractBoundary.parseInstallationSelfView(
            """{"factVersion":1.0,"updatedAt":"2026-09-29T00:00:00.1234567890Z","installationId":"$id","state":"unassociated","deviceId":null}""",
        )
        assertEquals(1L, preciseView.factVersion)
        assertEquals("2026-09-29T00:00:00.1234567890Z", preciseView.updatedAt)
    }

    @Test
    fun rejectsOldVersionUnknownFieldsAndContradictoryState() {
        val invalidPayloads = listOf(
            """{"contractVersion":"2026-09-28.identity-v0","associationCode":"sgassoc_v1_${"A".repeat(43)}"}""",
            """{"contractVersion":"${GeneratedFirstBatchContractSpec.CONTRACT_VERSION}","associationCode":"sgassoc_v1_${"A".repeat(43)}","providerId":"$id"}""",
        )
        invalidPayloads.forEach { raw ->
            assertFailsWith<ContractBoundaryException> {
                FirstBatchContractBoundary.parseAssociationQrPayload(raw)
            }
        }
        assertFailsWith<ContractBoundaryException> {
            FirstBatchContractBoundary.parseInstallationSelfView(
                """{"factVersion":1,"updatedAt":"2026-09-29T00:00:00Z","installationId":"$id","state":"unassociated","deviceId":"$id"}""",
            )
        }
        assertFailsWith<ContractBoundaryException> {
            FirstBatchContractBoundary.parseInstallationSelfView(
                """{"factVersion":"1","updatedAt":"2026-09-29T00:00:00Z","installationId":"$id","state":"unassociated","deviceId":null}""",
            )
        }
        assertFailsWith<ContractBoundaryException> {
            FirstBatchContractBoundary.parseProductError(
                """{"contractVersion":"${GeneratedFirstBatchContractSpec.CONTRACT_VERSION}","requestId":"request-0001","error":{"code":"INPUT_INVALID","message":"invalid","retryable":"false"}}""",
            )
        }
    }
}
