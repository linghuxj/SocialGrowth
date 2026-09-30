package com.socialgrowth.product

import java.net.Inet6Address
import java.net.InetAddress

// IPv4 link-local needs byte equality, not an IPv6 interface scope. Retain the
// strict nonzero/equal scope requirement for actual IPv6 link-local addresses.
internal fun sameDiscoveryAddress(a: InetAddress, b: InetAddress): Boolean {
    if (!a.address.contentEquals(b.address)) return false
    return if (a is Inet6Address && a.isLinkLocalAddress) {
        b is Inet6Address && a.scopeId != 0 && a.scopeId == b.scopeId
    } else true
}
