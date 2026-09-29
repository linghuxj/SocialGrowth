package com.socialgrowth.product

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

class DeviceFactPresentationTest {
    @Test
    fun associationAndAccessStatesNeverClaimOnlineOrTaskReadiness() {
        for (state in listOf("associated_pending_access", "access_ready", "paused", "exit_pending", "exited")) {
            val text = DeviceFactPresentation.state(state)
            assertFalse(text.contains("在线"))
            assertFalse(text.contains("可接任务"))
            assertFalse(text.contains("授权有效"))
        }
        assertEquals("接入已就绪", DeviceFactPresentation.state("access_ready"))
        assertEquals("连接状态未知", DeviceFactPresentation.CONNECTION_UNKNOWN)
    }

    @Test
    fun missingObservationDoesNotBecomeAnOfflineClaim() {
        assertEquals("暂无权威观察", DeviceFactPresentation.observation(null))
        assertFalse(DeviceFactPresentation.observation(null).contains("离线"))
    }
}
