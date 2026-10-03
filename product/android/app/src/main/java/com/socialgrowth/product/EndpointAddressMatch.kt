package com.socialgrowth.product

import java.net.Inet6Address
import java.net.InetAddress

// LinkProperties contains assigned addresses rather than remote endpoints. Bind
// an unscoped local IPv6 link address to its actual selected network interface;
// never repair or loosen the scope of an advertised remote service address.
internal fun localDiscoveryAddress(address: InetAddress, interfaceIndex: Int?): InetAddress =
    if (address is Inet6Address && address.isLinkLocalAddress && address.scopeId == 0 && interfaceIndex != null && interfaceIndex > 0)
        Inet6Address.getByAddress(null, address.address, interfaceIndex)
    else address

// IPv4 link-local needs byte equality, not an IPv6 interface scope. Retain the
// strict nonzero/equal scope requirement for actual IPv6 link-local addresses.
internal fun sameDiscoveryAddress(a: InetAddress, b: InetAddress): Boolean {
    if (!a.address.contentEquals(b.address)) return false
    return if (a is Inet6Address && a.isLinkLocalAddress) {
        b is Inet6Address && a.scopeId != 0 && a.scopeId == b.scopeId
    } else true
}
