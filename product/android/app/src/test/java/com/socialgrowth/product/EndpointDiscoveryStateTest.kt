package com.socialgrowth.product

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class EndpointDiscoveryStateTest {
    private val connect = EndpointPurpose.CONNECT
    private val pairing = EndpointPurpose.PAIRING
    private fun local(s: EndpointDiscoveryState, purpose: EndpointPurpose, name: String, port: Int): java.util.UUID {
        val g = s.snapshot().generation!!; val ticket = s.found(g, purpose, name)!!; s.resolved(g, purpose, name, ticket, true, port); return ticket
    }
    @Test fun emptyDiscoveryIsUnknownNotAbsentOrUnpaired() {
        val s = EndpointDiscoveryState(); s.begin(); assertEquals(EndpointObservationStatus.UNKNOWN, s.snapshot().connect.status); assertNull(s.snapshot().pairing.port)
    }
    @Test fun pairingAndConnectionPortsCannotOverwriteOneAnother() {
        val s = EndpointDiscoveryState(); s.begin(); local(s, connect, "synthetic-connect", 40001); local(s, pairing, "synthetic-pairing", 40002)
        assertEquals(40001, s.snapshot().connect.port); assertEquals(40002, s.snapshot().pairing.port)
    }
    @Test fun remoteServiceIsIgnoredAndNeverSelectedAsFirstCandidate() {
        val s = EndpointDiscoveryState(); val g = s.begin(); val t = s.found(g, connect, "synthetic-foreign")!!; s.resolved(g, connect, "synthetic-foreign", t, false, 40001)
        assertNull(s.snapshot().connect.port); local(s, connect, "synthetic-local", 40002); assertEquals(40002, s.snapshot().connect.port)
    }
    @Test fun unresolvedServiceCannotBePretendedRemoteToSelectKnownCandidate() {
        val s = EndpointDiscoveryState(); val g = s.begin(); local(s, connect, "synthetic-local", 40001); s.found(g, connect, "synthetic-pending")
        assertEquals(EndpointObservationStatus.UNKNOWN, s.snapshot().connect.status); assertNull(s.snapshot().connect.port)
    }
    @Test fun twoLocalServicesAreConflictEvenAtTheSamePort() {
        val s = EndpointDiscoveryState(); s.begin(); local(s, connect, "synthetic-a", 40001); local(s, connect, "synthetic-b", 40001)
        assertEquals(EndpointObservationStatus.CONFLICT, s.snapshot().connect.status); assertNull(s.snapshot().connect.port)
    }
    @Test fun localLossRevokesPortAndLateOldUpdateCannotRecreateIt() {
        val s = EndpointDiscoveryState(); val g = s.begin(); val t = local(s, connect, "synthetic-a", 40001); s.removed(g, connect, "synthetic-a", t); s.resolved(g, connect, "synthetic-a", t, true, 40001)
        assertEquals(EndpointObservationStatus.LOST, s.snapshot().connect.status); assertNull(s.snapshot().connect.port)
    }
    @Test fun reappearingNameGetsNewTicketAndOldCallbacksCannotOverwriteNewPort() {
        val s = EndpointDiscoveryState(); val g = s.begin(); val old = local(s, connect, "synthetic-a", 40001); s.removed(g, connect, "synthetic-a", old); val next = local(s, connect, "synthetic-a", 40002)
        assertNotEquals(old, next); s.resolved(g, connect, "synthetic-a", old, true, 50000); s.removed(g, connect, "synthetic-a", old); assertEquals(40002, s.snapshot().connect.port)
    }
    @Test fun newGenerationRejectsLateResolveLossFailureAndStopOfOldGeneration() {
        val s = EndpointDiscoveryState(); val old = s.begin(); val t = local(s, connect, "synthetic-a", 40001); val current = s.begin(); local(s, connect, "synthetic-b", 40002)
        s.resolved(old, connect, "synthetic-a", t, true, 50000); s.removed(old, connect, "synthetic-a", t); s.problem(old, connect, "discovery_failed"); s.stop(old); s.cleanupFailed(old)
        assertEquals(current, s.snapshot().generation); assertEquals(40002, s.snapshot().connect.port); assertTrue(s.snapshot().issues.isEmpty())
    }
    @Test fun stoppedWindowNeverReturnsAUsablePortOrAcceptsLateCallbacks() {
        val s = EndpointDiscoveryState(); val g = s.begin(); val t = local(s, connect, "synthetic-a", 40001); s.stop(g, "window_ended"); s.resolved(g, connect, "synthetic-a", t, true, 50000)
        assertFalse(s.snapshot().active); assertEquals(EndpointObservationStatus.STOPPED, s.snapshot().connect.status); assertNull(s.snapshot().connect.port); assertNull(s.found(g, connect, "synthetic-b"))
    }
    @Test fun invalidPortAndPlatformFailureAreStickyUnknownUntilNewGeneration() {
        val s = EndpointDiscoveryState(); val g = s.begin(); val t = s.found(g, connect, "synthetic-a")!!; s.resolved(g, connect, "synthetic-a", t, true, 65536); s.resolved(g, connect, "synthetic-a", t, true, 40001)
        assertEquals(EndpointObservationStatus.UNKNOWN, s.snapshot().connect.status); assertTrue(s.snapshot().issues.contains("connect:invalid_port")); assertNull(s.snapshot().connect.port)
        local(s, pairing, "synthetic-pair", 40002); assertEquals(40002, s.snapshot().pairing.port)
    }
    @Test fun serviceCapacityIsBoundedWithoutSilentlySelectingAnArbitrarySubset() {
        val s = EndpointDiscoveryState(); val g = s.begin(); repeat(64) { i -> local(s, connect, "synthetic-$i", 40001) }
        assertNull(s.found(g, connect, "synthetic-overflow")); assertEquals(EndpointObservationStatus.UNKNOWN, s.snapshot().connect.status)
    }
    @Test fun projectionsDoNotExposeNamesAddressesSecretsOrMutableInternalIssues() {
        val s = EndpointDiscoveryState(); val g = s.begin(); local(s, connect, "synthetic-private-name", 40001); s.problem(g, connect, "synthetic-secret-bearing-cause")
        val before = s.snapshot(); assertEquals(setOf("connect:platform_failure"), before.issues); assertFalse(before.toString().contains("synthetic-private")); assertFalse(before.toString().contains("secret-bearing"))
        s.begin(); assertEquals(setOf("connect:platform_failure"), before.issues); assertTrue(s.snapshot().issues.isEmpty())
    }
}
