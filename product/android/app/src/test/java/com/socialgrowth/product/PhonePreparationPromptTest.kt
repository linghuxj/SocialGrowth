package com.socialgrowth.product

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertFalse

/** Decision boundaries, not UI snapshots or simulated device acceptance. */
class PhonePreparationPromptTest {
    private val ready = DevicePreparationChecks(true, false, false, false, false, true, true, true,
        notificationsAllowed = true, backgroundRestricted = false, batteryOptimizationExempt = false)
    private fun fact(pairing: String = "awaiting_code", connection: String = "not_connected", network: String = "bootstrap") =
        DeviceConnectionSnapshot(UUID.randomUUID(), 1, network, pairing, connection, null, null, null)
    private fun next(local: DevicePreparationChecks = ready, associated: Boolean = true, automatic: Boolean = true,
                     reporting: Boolean = true, observed: DeviceConnectionSnapshot? = fact(), failed: Boolean = false,
                     state: String = "associated_pending_access") =
        PhonePreparationPrompt.next(local, associated, automatic, reporting, true, observed, failed, state)

    @Test fun restrictedBackgroundMustBeHandledBeforeLeavingAppToPair() {
        assertEquals(PreparationAction.BACKGROUND, next(ready.copy(backgroundRestricted = true)).action)
        // A system optimization exemption never overrides an explicit app restriction.
        assertEquals(PreparationAction.BACKGROUND, next(ready.copy(backgroundRestricted = true, batteryOptimizationExempt = true)).action)
        assertEquals(PreparationAction.BACKGROUND, next(ready.copy(backgroundRestricted = null, batteryOptimizationExempt = null)).action)
    }
    @Test fun localPrerequisitesNeverClaimPlatformConnected() {
        assertEquals(PreparationAction.ASSOCIATE, next(associated = false, observed = fact("paired", "connected")).action)
        assertEquals(PreparationAction.NOTIFICATIONS, next(ready.copy(notificationsAllowed = false)).action)
        assertEquals(PreparationAction.WIFI, next(ready.copy(wifiConnected = false)).action)
        assertEquals(PreparationAction.CHECK, next(observed = null).action)
        assertEquals(PreparationAction.CHECK, next(observed = fact(network = "pending")).action)
    }
    @Test fun pairedOrUnknownSubmissionNeverOffersAnotherPairingCode() {
        assertEquals(PreparationAction.CHECK, next(observed = fact("paired", "stale")).action)
        assertEquals(PreparationAction.CHECK, next(observed = fact("unknown")).action)
        assertEquals(PreparationAction.NONE, next(observed = fact("pairing")).action)
    }
    @Test fun explicitPauseNeedsExplicitResumeAndBusinessPauseHasNoStartAction() {
        assertEquals(PreparationAction.RESUME, next(automatic = false, observed = fact("paired", "connected")).action)
        for (state in listOf("paused", "exited", "exit_pending")) {
            val prompt = next(automatic = false, reporting = false, state = state)
            assertEquals(PreparationAction.NONE, prompt.action)
            assertNull(prompt.button)
        }
    }
    @Test fun currentConnectionHidesManualSetupButFailedCheckCannotShowCompletion() {
        val prompt = next(observed = fact("paired", "connected"))
        assertEquals(PreparationAction.NONE, prompt.action)
        assertNull(prompt.button)
        assertFalse(prompt.title.contains("准备完成"))
        assertEquals(PreparationAction.CHECK, next(observed = fact("paired", "connected"), failed = true).action)
        assertEquals(PreparationAction.PAIR, next().action)
    }
}
