package com.socialgrowth.product

import androidx.annotation.RequiresApi
import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.os.Handler
import android.os.Looper
import java.net.Inet6Address
import java.net.InetAddress
import java.util.UUID

// Main-thread-owned, bounded observation. A future foreground lifecycle consumer
// must close on background/pause; this class is not a persistent service.
@RequiresApi(34)
class NativeEndpointDiscovery(context: Context) {
    private val app = context.applicationContext
    private val handler = Handler(Looper.getMainLooper())
    private val state = EndpointDiscoveryState()
    private var run: Run? = null
    private data class Resolution(val ticket: UUID, val callback: NsdManager.ServiceInfoCallback)
    private inner class Run(val generation: UUID, val wifi: Network, val locals: List<InetAddress>, val nsd: NsdManager, val connectivity: ConnectivityManager) {
        val discoveries = mutableListOf<NsdManager.DiscoveryListener>()
        val resolutions = mutableMapOf<Pair<EndpointPurpose, String>, Resolution>()
        var networkCallback: ConnectivityManager.NetworkCallback? = null
        var timeout: Runnable? = null
    }
    fun snapshot() = state.snapshot()
    fun start(windowMillis: Long = 20_000): EndpointDiscoverySnapshot {
        requireMain(); require(windowMillis in 1_000..30_000) { "Invalid observation window" }
        close(); val generation = state.begin()
        try {
            val cm = app.getSystemService(ConnectivityManager::class.java)
            val wifi = cm.allNetworks.filter { network -> cm.getNetworkCapabilities(network)?.let { it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) } == true }
            if (wifi.size != 1) { state.stop(generation, "wifi_selection_blocked"); return snapshot() }
            val locals = addresses(cm.getLinkProperties(wifi.single()))
            if (locals.isEmpty()) { state.stop(generation, "wifi_addresses_unknown"); return snapshot() }
            val current = Run(generation, wifi.single(), locals, app.getSystemService(NsdManager::class.java), cm); run = current
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) { if (live(current) && network != current.wifi) close("network_changed") }
                override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                    if (live(current) && network == current.wifi && (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN))) close("network_changed")
                }
                override fun onLost(network: Network) { if (live(current) && network == current.wifi) close("network_lost") }
                override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) {
                    if (live(current) && network == current.wifi && fingerprints(addresses(properties)) != fingerprints(current.locals)) close("network_changed")
                }
            }
            current.networkCallback = callback
            cm.registerNetworkCallback(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), callback, handler)
            discover(current, EndpointPurpose.CONNECT, "_adb-tls-connect._tcp.")
            discover(current, EndpointPurpose.PAIRING, "_adb-tls-pairing._tcp.")
            current.timeout = Runnable { if (live(current)) close("window_ended") }.also { handler.postDelayed(it, windowMillis) }
        } catch (_: RuntimeException) { if (run != null) close("setup_failed") else state.stop(generation, "setup_failed") }
        return snapshot()
    }
    fun close(reason: String? = null) {
        requireMain(); val current = run ?: return
        run = null; state.stop(current.generation, reason) // Invalidate before invoking asynchronous cleanup.
        current.timeout?.let { handler.removeCallbacks(it) }
        for (listener in current.discoveries) try { current.nsd.stopServiceDiscovery(listener) } catch (_: RuntimeException) { state.cleanupFailed(current.generation) }
        for (resolution in current.resolutions.values) try { current.nsd.unregisterServiceInfoCallback(resolution.callback) } catch (_: RuntimeException) { state.cleanupFailed(current.generation) }
        current.networkCallback?.let { try { current.connectivity.unregisterNetworkCallback(it) } catch (_: RuntimeException) { state.cleanupFailed(current.generation) } }
        current.resolutions.clear(); current.discoveries.clear()
    }
    private fun discover(current: Run, purpose: EndpointPurpose, type: String) {
        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) = Unit
            override fun onDiscoveryStopped(serviceType: String) { current.discoveries.remove(this); if (live(current)) state.problem(current.generation, purpose, "unexpected_stop") }
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { current.discoveries.remove(this); if (live(current)) state.problem(current.generation, purpose, "discovery_failed") }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) { state.cleanupFailed(current.generation) }
            override fun onServiceFound(info: NsdServiceInfo) {
                if (!live(current)) return
                val name = info.serviceName ?: ""
                val key = purpose to name
                if (key in current.resolutions) return
                val ticket = state.found(current.generation, purpose, name) ?: return
                val callback = object : NsdManager.ServiceInfoCallback {
                    override fun onServiceInfoCallbackRegistrationFailed(errorCode: Int) {
                        if (live(current) && current.resolutions[key]?.ticket == ticket) { current.resolutions.remove(key); state.problem(current.generation, purpose, "resolution_failed") }
                    }
                    override fun onServiceUpdated(service: NsdServiceInfo) {
                        if (!live(current) || current.resolutions[key]?.ticket != ticket) return
                        // Match only addresses reported on the exact selected Wi-Fi.
                        try {
                            if (fingerprints(addresses(current.connectivity.getLinkProperties(current.wifi))) != fingerprints(current.locals)) { close("network_changed"); return }
                            val hosts = service.hostAddresses
                            if (hosts.isEmpty() || service.network == null || service.serviceName != name || service.serviceType.trimEnd('.') != type.trimEnd('.')) { state.problem(current.generation, purpose, "resolution_failed"); return }
                            val local = service.network == current.wifi && hosts.all { host -> current.locals.any { sameAddress(host, it) } }
                            state.resolved(current.generation, purpose, name, ticket, local, service.port)
                        } catch (_: RuntimeException) { state.problem(current.generation, purpose, "resolution_failed") }
                    }
                    override fun onServiceLost() { remove(current, purpose, name, ticket) }
                    override fun onServiceInfoCallbackUnregistered() = Unit
                }
                current.resolutions[key] = Resolution(ticket, callback)
                try { current.nsd.registerServiceInfoCallback(info, app.mainExecutor, callback) } catch (_: RuntimeException) { current.resolutions.remove(key); state.problem(current.generation, purpose, "resolution_failed") }
            }
            override fun onServiceLost(info: NsdServiceInfo) {
                val name = info.serviceName ?: return
                current.resolutions[purpose to name]?.let { remove(current, purpose, name, it.ticket) }
            }
        }
        current.discoveries.add(listener)
        try { current.nsd.discoverServices(type, NsdManager.PROTOCOL_DNS_SD, current.wifi, app.mainExecutor, listener) } catch (_: RuntimeException) { current.discoveries.remove(listener); state.problem(current.generation, purpose, "discovery_failed") }
    }
    private fun remove(current: Run, purpose: EndpointPurpose, name: String, ticket: UUID) {
        if (!live(current) || current.resolutions[purpose to name]?.ticket != ticket) return
        val callback = current.resolutions.remove(purpose to name)!!.callback
        state.removed(current.generation, purpose, name, ticket)
        try { current.nsd.unregisterServiceInfoCallback(callback) } catch (_: RuntimeException) { state.problem(current.generation, purpose, "resolution_failed") }
    }
    private fun live(current: Run) = run === current
    private fun addresses(properties: LinkProperties?) = properties?.linkAddresses?.map { it.address }?.filter { !it.isLoopbackAddress && !it.isAnyLocalAddress }.orEmpty()
    private fun fingerprints(addresses: List<InetAddress>) = addresses.map { it.address.joinToString(",") + "/" + ((it as? Inet6Address)?.scopeId ?: 0) }.toSet()
    private fun sameAddress(a: InetAddress, b: InetAddress): Boolean = sameDiscoveryAddress(a, b)
    private fun requireMain() { check(Looper.myLooper() == Looper.getMainLooper()) { "Discovery lifecycle requires main thread" } }
}
