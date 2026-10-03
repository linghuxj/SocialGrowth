package com.socialgrowth.product

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

class DeviceControlApiClientTest {
    private val client = DeviceControlApiClient("https://example.invalid")

    @Test
    fun acceptsInitialNotRequestedAndPausedFactsAccordingToJournalConstraints() {
        val deviceId = UUID.randomUUID()
        val initial = client.parse(
            """{"contractVersion":"2026-09-29.identity-v1","deviceId":"$deviceId","requestId":null,"intent":"active","controlVersion":null,"controlGeneration":null,"stop":"not_requested","unresolvedActionCount":0,"checkedAt":"2026-10-04T00:00:00Z"}""",
        )
        assertEquals(deviceId, initial.deviceId)
        assertEquals("not_requested", initial.stop)
        assertNull(initial.requestId)
        assertNull(initial.controlVersion)
        assertNull(initial.controlGeneration)

        val paused = client.parse(
            """{"contractVersion":"2026-09-29.identity-v1","deviceId":"$deviceId","requestId":"android-request-1","intent":"paused","controlVersion":3,"controlGeneration":"2","stop":"requested","unresolvedActionCount":1,"checkedAt":"2026-10-04T00:00:00Z"}""",
        )
        assertEquals("paused", paused.intent)
        assertEquals("requested", paused.stop)
    }

    @Test
    fun rejectsUnknownIntentAndContradictoryTypes() {
        val payload = """{"contractVersion":"2026-09-29.identity-v1","deviceId":"${UUID.randomUUID()}","requestId":null,"intent":"active","controlVersion":null,"controlGeneration":null,"stop":"not_requested","unresolvedActionCount":0,"checkedAt":"2026-10-04T00:00:00Z"}"""
        assertFailsWith<IllegalStateException> { client.parse(payload.replace("\"active\"", "\"withdrawn\"")) }
        assertFailsWith<IllegalStateException> { client.parse(payload.replace("\"unresolvedActionCount\":0", "\"unresolvedActionCount\":\"0\"")) }
        assertFailsWith<IllegalStateException> { client.parse(payload.replace("\"not_requested\"", "\"unknown\"")) }
        assertFailsWith<IllegalStateException> { client.parse(payload.replace("2026-09-29.identity-v1", "2026-09-29.identity-v2")) }
        assertFailsWith<IllegalStateException> { client.parse(payload.replace("\"controlGeneration\":null", "\"controlGeneration\":\"0\"")) }

        val confirmed = payload.replace("\"controlVersion\":null", "\"controlVersion\":1")
            .replace("\"controlGeneration\":null", "\"controlGeneration\":\"1\"")
            .replace("\"not_requested\"", "\"confirmed\"")
        assertFailsWith<IllegalStateException> { client.parse(confirmed.replace("\"unresolvedActionCount\":0", "\"unresolvedActionCount\":1")) }
    }
}
