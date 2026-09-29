package com.socialgrowth.product

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import java.util.UUID

class AssociationContractBoundaryTest {
    private val installationId = UUID.randomUUID()
    private val sessionId = UUID.randomUUID()

    @Test
    fun parsesInstallationAuthWithoutAcceptingCredentialEcho() {
        val parsed = AssociationContractBoundary.parseInstallationAuth(
            """{
              "installation":{"installationId":"$installationId","generation":1,"status":"active","createdAt":"2026-09-29T00:00:00Z","updatedAt":"2026-09-29T00:00:00Z"},
              "session":{"sessionId":"$sessionId","createdAt":"2026-09-29T00:00:00Z","expiresAt":"2026-09-30T00:00:00Z"},
              "sessionToken":"${"A".repeat(43)}","createdNewInstallation":true
            }""",
        )
        assertEquals(installationId, parsed.installationId)
        assertEquals(1, parsed.generation)

        assertFailsWith<ContractBoundaryException> {
            AssociationContractBoundary.parseInstallationAuth(
                """{
                  "installation":{"installationId":"$installationId","generation":1,"status":"active","createdAt":"2026-09-29T00:00:00Z","updatedAt":"2026-09-29T00:00:00Z"},
                  "session":{"sessionId":"$sessionId","createdAt":"2026-09-29T00:00:00Z","expiresAt":"2026-09-30T00:00:00Z"},
                  "sessionToken":"${"A".repeat(43)}","createdNewInstallation":true,
                  "installationCredential":"sginst_v1_${"B".repeat(43)}"
                }""",
            )
        }
    }

    @Test
    fun preservesContractTimestampPrecisionAndSafeIntegerBounds() {
        val precise = """{
          "installation":{"installationId":"$installationId","generation":9007199254740991,"status":"active","createdAt":"2026-09-29T00:00:00.0000000001Z","updatedAt":"2026-09-29T00:00:00.0000000002Z"},
          "session":{"sessionId":"$sessionId","createdAt":"2026-09-29T00:00:00.0000000002Z","expiresAt":"2026-09-30T00:00:00Z"},
          "sessionToken":"${"A".repeat(43)}","createdNewInstallation":false
        }"""
        assertEquals(9_007_199_254_740_991L, AssociationContractBoundary.parseInstallationAuth(precise).generation)
        assertFailsWith<ContractBoundaryException> {
            AssociationContractBoundary.parseInstallationAuth(
                precise.replace("9007199254740991", "9007199254740992"),
            )
        }
        assertFailsWith<ContractBoundaryException> {
            AssociationContractBoundary.parseInstallationAuth(
                precise.replace("2026-09-29T00:00:00.0000000002Z", "2026-09-28T23:59:59Z"),
            )
        }
    }

    @Test
    fun parsesPendingAndAssociatedResultsStrictly() {
        val pending = AssociationContractBoundary.parseResult(
            """{"status":"pending","associationSessionId":"$sessionId","installationId":"$installationId","expiresAt":"2026-09-30T00:00:00Z"}""",
        )
        assertNull(pending)

        val receipt = AssociationContractBoundary.parseResult(
            """{"status":"associated","result":{
              "associationId":"${UUID.randomUUID()}","providerId":"${UUID.randomUUID()}",
              "installationId":"$installationId","deviceId":"${UUID.randomUUID()}",
              "confirmedAt":"2026-09-29T00:01:00Z","state":"associated_pending_access"
            }}""",
        )
        assertEquals(installationId, receipt?.installationId)
    }

    @Test
    fun providerDeviceListNeverAcceptsInstallationId() {
        val valid = """{"devices":[{
          "factVersion":2,"updatedAt":"2026-09-29T00:01:00Z","deviceId":"${UUID.randomUUID()}",
          "displayName":"执行手机 A","state":"associated_pending_access","lastObservedAt":null
        }]}"""
        assertEquals(1, AssociationContractBoundary.parseDevices(valid).size)
        assertFailsWith<ContractBoundaryException> {
            AssociationContractBoundary.parseDevices(
                valid.replace("\"displayName\"", "\"installationId\":\"$installationId\",\"displayName\""),
            )
        }
    }
}
