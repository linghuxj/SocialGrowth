package com.socialgrowth.product

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlin.test.assertEquals

class ParticipationFreshnessTest {
    @Test fun expiredBackgroundRunCannotResumeOnForegroundReturn() {
        val run = ParticipationFreshness()
        assertTrue(run.canContinue(100))
        run.confirmed(100)
        assertTrue(run.canContinue(10_099))
        assertFalse(run.canContinue(10_100))
        assertFalse(run.canContinue(44_100))
        assertTrue(ParticipationFreshness().canContinue(44_100)) // New visible run only.
    }
    @Test fun normalPulsesRetainTheCurrentRunButDelayCannotExtendOldDeadline() {
        val run = ParticipationFreshness()
        run.confirmed(100)
        assertTrue(run.canContinue(4_500))
        run.confirmed(4_100)
        assertTrue(run.canContinue(14_099))
        assertFalse(run.canContinue(14_100))
    }
    @Test fun transportLatencyDoesNotAccumulateWithTheFixedHeartbeatWait() {
        val run = ParticipationFreshness()
        run.confirmed(100)
        assertEquals(3_700L, run.nextRoundDelay(100, 400))
        assertEquals(1_100L, run.nextRoundDelay(100, 3_000))
        assertEquals(0L, run.nextRoundDelay(100, 5_000))
        assertFalse(run.canContinue(10_100))
    }
}
