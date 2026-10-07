package com.socialgrowth.product

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class InstallationSessionReplacementTest {
    private val originalId = UUID.fromString("12345678-1234-4234-8234-123456789012")
    private val original = StoredInstallationIdentity(
        "local-synthetic-credential", originalId.toString(), 1,
        "old-token", "2026-10-02T00:00:00Z",
        UUID.randomUUID().toString(), "old-association-code", "2026-10-04T00:00:00Z",
    )

    @Test fun renewedOriginalIdentityRetainsCurrentAssociation() {
        val renewed = original.withAuth(InstallationAuth(originalId, 1, "new-token", "2026-11-02T00:00:00Z"))
        assertEquals(original.credential, renewed.credential)
        assertEquals(original.associationCode, renewed.associationCode)
        assertEquals("new-token", renewed.sessionToken)
    }

    @Test fun changedIdentityOrGenerationCannotReuseAnOldAssociationCode() {
        for (auth in listOf(
            InstallationAuth(UUID.randomUUID(), 1, "new-token", "2026-11-02T00:00:00Z"),
            InstallationAuth(originalId, 2, "new-token", "2026-11-02T00:00:00Z"),
        )) {
            val renewed = original.withAuth(auth)
            assertEquals(original.credential, renewed.credential)
            assertNull(renewed.associationSessionId)
            assertNull(renewed.associationCode)
            assertNull(renewed.associationExpiresAt)
        }
    }
}
