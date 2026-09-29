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

    @Test
    fun validatesProviderVerificationAndAuthWithoutLeakingPhone() {
        val challenge = FirstBatchContractBoundary.parsePhoneVerificationChallenge(
            """{"challengeId":"$id","purpose":"provider_registration","phoneHint":"+86*******001","deliveryState":"accepted","expiresAt":"2026-09-29T00:05:00.0000000001Z","resendAvailableAt":"2026-09-29T00:01:00Z"}""",
        )
        assertEquals("accepted", challenge.deliveryState)

        val proof = FirstBatchContractBoundary.parsePhoneVerificationProof(
            """{"phoneVerificationId":"$id","purpose":"provider_login","phoneHint":"+86*******001","verifiedAt":"2026-09-29T00:00:00.0000000001Z","expiresAt":"2026-09-29T00:05:00Z"}""",
        )
        assertEquals("provider_login", proof.purpose)

        val auth = FirstBatchContractBoundary.parseProviderAuthResponse(
            """{"provider":{"providerId":"$id","displayName":"设备提供者","phoneHint":"+86*******001","status":"active","createdAt":"2026-09-29T00:00:00Z","updatedAt":"2026-09-29T00:00:00.0000000001Z"},"session":{"sessionId":"00000000-0000-4000-8000-000000000002","createdAt":"2026-09-29T00:00:00Z","expiresAt":"2026-10-29T00:00:00Z"},"sessionToken":"${"A".repeat(43)}"}""",
        )
        assertEquals("+86*******001", auth.provider.phoneHint)

        val supplementaryPlaneName = FirstBatchContractBoundary.parseProviderSelfView(
            """{"providerId":"$id","displayName":"${"😀".repeat(51)}","phoneHint":"+86*******001","status":"active","createdAt":"2026-09-29T08:00:00+19:00","updatedAt":"2026-09-29T08:00:00.0000000001+19:00"}""",
        )
        assertEquals(51, supplementaryPlaneName.displayName.codePointCount(0, supplementaryPlaneName.displayName.length))
    }

    @Test
    fun rejectsProviderAuthSemanticContradictions() {
        val invalidChallenges = listOf(
            """{"challengeId":"$id","purpose":"provider_registration","phoneHint":"+8613800000001","deliveryState":"accepted","expiresAt":"2026-09-29T00:05:00Z","resendAvailableAt":"2026-09-29T00:01:00Z"}""",
            """{"challengeId":"$id","purpose":"provider_registration","phoneHint":"+86*******001","deliveryState":"delivered","expiresAt":"2026-09-29T00:05:00Z","resendAvailableAt":"2026-09-29T00:01:00Z"}""",
            """{"challengeId":"$id","purpose":"provider_registration","phoneHint":"+86*******001","deliveryState":"accepted","expiresAt":"2026-09-29T00:05:00Z","resendAvailableAt":"2026-09-29T00:06:00Z"}""",
        )
        invalidChallenges.forEach { raw ->
            assertFailsWith<ContractBoundaryException> {
                FirstBatchContractBoundary.parsePhoneVerificationChallenge(raw)
            }
        }
        assertFailsWith<ContractBoundaryException> {
            FirstBatchContractBoundary.parsePhoneVerificationProof(
                """{"phoneVerificationId":"$id","purpose":"provider_login","phoneHint":"+86*******001","verifiedAt":"2026-09-29T00:05:00Z","expiresAt":"2026-09-29T00:05:00Z"}""",
            )
        }
        assertFailsWith<ContractBoundaryException> {
            FirstBatchContractBoundary.parseProviderSelfView(
                """{"providerId":"$id","displayName":"设备提供者","phoneHint":"+86*******001","status":"active","createdAt":"2026-09-29T00:00:00Z","updatedAt":"2026-09-28T23:59:59Z"}""",
            )
        }
        assertFailsWith<ContractBoundaryException> {
            FirstBatchContractBoundary.parseProviderSelfView(
                """{"providerId":"$id","displayName":"${"😀".repeat(101)}","phoneHint":"+86*******001","status":"active","createdAt":"2026-09-29T00:00:00Z","updatedAt":"2026-09-29T00:00:00Z"}""",
            )
        }
        assertFailsWith<ContractBoundaryException> {
            FirstBatchContractBoundary.parseProviderAuthResponse(
                """{"provider":{"providerId":"$id","displayName":"设备提供者","phoneHint":"+86*******001","status":"active","createdAt":"2026-09-29T00:00:00Z","updatedAt":"2026-09-29T00:00:00Z"},"session":{"sessionId":"00000000-0000-4000-8000-000000000002","createdAt":"2026-09-29T00:00:00Z","expiresAt":"2026-09-29T00:00:00Z"},"sessionToken":"${"A".repeat(43)}"}""",
            )
        }
    }
}
