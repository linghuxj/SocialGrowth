package com.socialgrowth.product

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class DeviceControlApiClientTest {
    private val client = DeviceControlApiClient("https://example.invalid")

    @Test
    fun acceptsInitialUnknownAndPausedFactsWithNullableControlIds() {
        val deviceId = UUID.randomUUID()
        val fact = client.parse(
            """{"deviceId":"$deviceId","requestId":null,"intent":"paused","controlVersion":null,"controlGeneration":null,"stop":"unknown","unresolvedActionCount":1,"checkedAt":"2026-10-04T00:00:00Z"}""",
        )
        assertEquals(deviceId, fact.deviceId)
        assertEquals("paused", fact.intent)
        assertEquals("unknown", fact.stop)
        assertNull(fact.requestId)
        assertNull(fact.controlVersion)
        assertNull(fact.controlGeneration)
    }

    @Test
    fun rejectsUnknownIntentAndContradictoryTypes() {
        val payload = """{"deviceId":"${UUID.randomUUID()}","requestId":null,"intent":"active","controlVersion":null,"controlGeneration":null,"stop":"not_requested","unresolvedActionCount":0,"checkedAt":"2026-10-04T00:00:00Z"}"""
        assertFailsWith<IllegalStateException> { client.parse(payload.replace("\"active\"", "\"withdrawn\"")) }
        assertFailsWith<IllegalStateException> { client.parse(payload.replace("\"unresolvedActionCount\":0", "\"unresolvedActionCount\":\"0\"")) }
    }
}
