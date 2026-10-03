package com.socialgrowth.product

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ProviderAssistanceApiClientTest {
    private val client = ProviderAssistanceApiClient("https://example.invalid")
    private val todoId = UUID.randomUUID()
    private val deviceId = UUID.randomUUID()

    @Test
    fun parsesHistoricalImpactWithoutTreatingItAsCurrentDeviceHealth() {
        val parsed = client.parse(
            """{"todos":[{"todoId":"$todoId","originScope":"unassigned_device","kind":"network_access_help","status":"awaiting_recheck","factVersion":3,"impactCount":2,"noteCount":1,"createdAt":"2026-10-01T00:00:00Z","updatedAt":"2026-10-02T00:00:00Z","impacts":[{"deviceId":"$deviceId","deviceLabel":"执行机 A","recordedDeviceVersion":7}]}],"nextAfterTodoId":null}""",
        )
        assertEquals(todoId, parsed.todos.single().todoId)
        assertEquals(deviceId, parsed.todos.single().impacts.single().deviceId)
        assertEquals(7, parsed.todos.single().impacts.single().recordedDeviceVersion)
    }

    @Test
    fun allowsNoCurrentlyOwnedImpactButRejectsPrivateOrContradictoryFacts() {
        val empty = """{"todos":[{"todoId":"$todoId","originScope":"unassigned_device","kind":"network_access_help","status":"open","factVersion":0,"impactCount":1,"noteCount":0,"createdAt":"2026-10-01T00:00:00Z","updatedAt":"2026-10-01T00:00:00Z","impacts":[]}],"nextAfterTodoId":null}"""
        val parsed = client.parse(empty).todos.single()
        assertEquals(1, parsed.impactCount)
        assertEquals(0, parsed.impacts.size)
        assertFailsWith<IllegalStateException> { client.parse(empty.replace("\"impacts\":[]", "\"impacts\":[],\"operatorId\":\"$deviceId\"")) }
        assertFailsWith<IllegalStateException> { client.parse(empty.replace("\"updatedAt\":\"2026-10-01T00:00:00Z\"", "\"updatedAt\":\"2026-09-30T00:00:00Z\"")) }
    }
}
