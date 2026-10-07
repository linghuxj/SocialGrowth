package com.socialgrowth.product

import java.util.UUID

enum class EndpointPurpose { CONNECT, PAIRING }
enum class EndpointObservationStatus { UNKNOWN, CANDIDATE, CONFLICT, LOST, STOPPED }
data class EndpointObservation(val status: EndpointObservationStatus, val port: Int?)
data class EndpointDiscoverySnapshot(val generation: UUID?, val active: Boolean, val connect: EndpointObservation, val pairing: EndpointObservation, val issues: Set<String>)

// Local observations only: no node identity, permission, trust, absence proof or
// execution lease. Names remain in memory and are never projected or logged.
class EndpointDiscoveryState {
    private data class Entry(val ticket: UUID, var resolved: Boolean = false, var local: Boolean = false, var port: Int? = null)
    private var generation: UUID? = null
    private var active = false
    private val entries = mutableMapOf<EndpointPurpose, MutableMap<String, Entry>>()
    private val lost = mutableSetOf<EndpointPurpose>()
    private val failed = mutableSetOf<EndpointPurpose>()
    private val issues = mutableSetOf<String>()

    @Synchronized fun begin(): UUID {
        generation = UUID.randomUUID(); active = true; entries.clear(); lost.clear(); failed.clear(); issues.clear()
        return generation!!
    }
    @Synchronized fun found(g: UUID, purpose: EndpointPurpose, name: String): UUID? {
        if (!current(g)) return null
        val rows = entries.getOrPut(purpose) { mutableMapOf() }
        if (name.isEmpty() || name.length > 255 || rows.size >= 64 && name !in rows) { problem(g, purpose, "capacity_or_name_invalid"); return null }
        if (name in rows) return rows[name]!!.ticket
        val ticket = UUID.randomUUID(); rows[name] = Entry(ticket); return ticket
    }
    @Synchronized fun resolved(g: UUID, purpose: EndpointPurpose, name: String, ticket: UUID, local: Boolean, port: Int) {
        val row = entries[purpose]?.get(name)
        if (!current(g) || row?.ticket != ticket) return
        if (port !in 1..65535) { problem(g, purpose, "invalid_port"); return }
        row.resolved = true; row.local = local; row.port = if (local) port else null
    }
    @Synchronized fun removed(g: UUID, purpose: EndpointPurpose, name: String, ticket: UUID) {
        val row = entries[purpose]?.get(name)
        if (!current(g) || row?.ticket != ticket) return
        if (row.local) lost.add(purpose)
        entries[purpose]?.remove(name)
    }
    @Synchronized fun problem(g: UUID, purpose: EndpointPurpose, reason: String) {
        if (!current(g)) return
        failed.add(purpose)
        // Do not propagate platform exception text, service names or payloads.
        issues.add("${purpose.name.lowercase()}:" + if (reason in setOf("capacity_or_name_invalid", "invalid_port", "discovery_failed", "resolution_failed", "unexpected_stop")) reason else "platform_failure")
    }
    @Synchronized fun stop(g: UUID, reason: String? = null) {
        if (!current(g)) return
        active = false; entries.clear()
        if (reason != null) issues.add(if (reason in setOf("network_changed", "network_lost", "wifi_selection_blocked", "wifi_addresses_unknown", "unsupported_api", "setup_failed", "window_ended", "cleanup_failed")) reason else "platform_failure")
    }
    @Synchronized fun cleanupFailed(g: UUID) { if (generation == g) issues.add("cleanup_failed") }
    @Synchronized fun snapshot(): EndpointDiscoverySnapshot {
        fun observation(purpose: EndpointPurpose): EndpointObservation {
            if (!active) return EndpointObservation(EndpointObservationStatus.STOPPED, null)
            val rows = entries[purpose]?.values?.toList().orEmpty()
            if (purpose in failed || rows.any { !it.resolved }) return EndpointObservation(EndpointObservationStatus.UNKNOWN, null)
            val local = rows.filter { it.local }
            return when {
                local.size > 1 -> EndpointObservation(EndpointObservationStatus.CONFLICT, null) // Even same-port services may be distinct devices.
                local.size == 1 -> EndpointObservation(EndpointObservationStatus.CANDIDATE, local.single().port)
                purpose in lost -> EndpointObservation(EndpointObservationStatus.LOST, null)
                else -> EndpointObservation(EndpointObservationStatus.UNKNOWN, null)
            }
        }
        return EndpointDiscoverySnapshot(generation, active, observation(EndpointPurpose.CONNECT), observation(EndpointPurpose.PAIRING), issues.toSet())
    }
    private fun current(g: UUID) = active && generation == g
}
