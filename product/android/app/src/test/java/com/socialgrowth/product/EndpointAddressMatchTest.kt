package com.socialgrowth.product

import java.net.Inet6Address
import java.net.InetAddress
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class EndpointAddressMatchTest {
    private fun v4(a: Int, b: Int, c: Int, d: Int): InetAddress = InetAddress.getByAddress(byteArrayOf(a.toByte(), b.toByte(), c.toByte(), d.toByte()))
    private fun v6(scope: Int, host: Int, local: Boolean = true): Inet6Address {
        val raw = ByteArray(16)
        raw[0] = (if (local) 0xfe else 0x20).toByte(); raw[1] = (if (local) 0x80 else 0x01).toByte(); raw[15] = host.toByte()
        return Inet6Address.getByAddress(null, raw, scope)
    }
    @Test fun ipv4LinkLocalAndNormalBytesMatchWithoutIpv6Scope() {
        for (address in listOf(v4(169, 254, 1, 2), v4(169, 254, 200, 210), v4(192, 0, 2, 10))) {
            assertTrue(sameDiscoveryAddress(address, InetAddress.getByAddress(address.address)))
        }
        assertFalse(sameDiscoveryAddress(v4(169, 254, 1, 2), v4(169, 254, 1, 3)))
        assertFalse(sameDiscoveryAddress(v4(192, 0, 2, 10), v4(192, 0, 2, 11)))
    }
    @Test fun ipv6LinkLocalStillRequiresNonzeroEqualScopeAndAddress() {
        assertTrue(sameDiscoveryAddress(v6(7, 1), v6(7, 1)))
        for (other in listOf(v6(0, 1), v6(8, 1), v6(7, 2))) {
            assertFalse(sameDiscoveryAddress(v6(7, 1), other))
            assertFalse(sameDiscoveryAddress(other, v6(7, 1)))
        }
        assertFalse(sameDiscoveryAddress(v6(0, 1), v6(0, 1)))
    }
    @Test fun nonLinkLocalIpv6IgnoresScopeButNeverMatchesOtherFamilyOrBytes() {
        assertTrue(sameDiscoveryAddress(v6(7, 1, false), v6(8, 1, false)))
        assertFalse(sameDiscoveryAddress(v6(7, 1, false), v6(7, 2, false)))
        assertFalse(sameDiscoveryAddress(v4(169, 254, 1, 2), v6(7, 1)))
        assertFalse(sameDiscoveryAddress(v6(7, 1), v4(169, 254, 1, 2)))
    }
    @Test fun assignedUnscopedLocalLinkAddressUsesOnlyItsActualInterfaceAndRemoteScopeRemainsStrict() {
        val assigned = v6(0, 1)
        assertTrue(sameDiscoveryAddress(v6(45, 1), localDiscoveryAddress(assigned, 45)))
        assertFalse(sameDiscoveryAddress(v6(44, 1), localDiscoveryAddress(assigned, 45)))
        assertFalse(sameDiscoveryAddress(v6(0, 1), localDiscoveryAddress(assigned, 45)))
        assertFalse(sameDiscoveryAddress(v6(45, 2), localDiscoveryAddress(assigned, 45)))
        assertFalse(sameDiscoveryAddress(v6(45, 1), localDiscoveryAddress(assigned, null)))
        assertFalse(sameDiscoveryAddress(v6(45, 1), localDiscoveryAddress(assigned, 0)))
        assertFalse(sameDiscoveryAddress(v6(45, 1), localDiscoveryAddress(v6(44, 1), 45)))
    }
}
