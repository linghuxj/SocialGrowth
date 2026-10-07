package com.socialgrowth.product

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class ProviderInvitationTest {
    private val code = "A".repeat(43)
    private val base = "https://growth.mhtm.top"
    @Test fun acceptsSharedCodeAndBothInvitationLinks() {
        assertEquals(code, ProviderInvitation.parse("  $code  ", base))
        assertEquals(code, ProviderInvitation.parse("$base/register?invitation=$code", base))
        assertEquals(code, ProviderInvitation.parse("socialgrowth://provider/register?invitation=$code", base))
    }
    @Test fun rejectsOtherOriginsAndAmbiguousOrMalformedCredentials() {
        for (input in listOf("https://other.example/register?invitation=$code", "http://growth.mhtm.top/register?invitation=$code",
            "$base:444/register?invitation=$code", "$base/register?invitation=$code&invitation=$code",
            "https://user@growth.mhtm.top/register?invitation=$code", "$base/register?invitation=$code#fragment",
            "$base/other?invitation=$code", "socialgrowth://other/register?invitation=$code", "bad-code",
            "$base/register?invitation=%ZZ", "$base/register?invitation=${"A".repeat(44)}")) {
            assertNull(ProviderInvitation.parse(input, base))
        }
    }
}
