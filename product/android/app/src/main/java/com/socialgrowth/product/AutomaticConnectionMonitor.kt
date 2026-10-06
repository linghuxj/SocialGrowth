package com.socialgrowth.product

import android.content.Intent
import android.content.ComponentName
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import java.util.UUID
import java.util.concurrent.ExecutorService

/** Restores only this installation's connection while the App is visible.
 * Does not create identities, pair, change system settings or resume tasks.
 * Shares the Activity worker so installation-session writes stay ordered.
 */
internal class AutomaticConnectionMonitor(
    private val activity: ComponentActivity,
    private val worker: ExecutorService,
) : DefaultLifecycleObserver {
    private val main = Handler(Looper.getMainLooper())
    private val identities = InstallationIdentityStore(activity)
    private val http = ProviderApiClient(BuildConfig.API_BASE_URL)
    private val association = AssociationApiClient(http)
    private var visible = false
    private var busy = false
    private var generation = 0
    private var failures = 0
    private var refreshSession = false
    private var bootstrapRequest = "automatic-session-${UUID.randomUUID()}"
    private var deniedToken: String? = null
    private val recovery = activity.getSharedPreferences("endpoint_connection", android.content.Context.MODE_PRIVATE)
    private var lastVpnAttempt = -30_000L
    private val tick = Runnable { check() }

    override fun onResume(owner: LifecycleOwner) {
        visible = true; ++generation; failures = 0; deniedToken = null
        main.removeCallbacks(tick); main.post(tick)
    }
    override fun onPause(owner: LifecycleOwner) {
        visible = false; ++generation; main.removeCallbacks(tick)
    }
    override fun onDestroy(owner: LifecycleOwner) { onPause(owner) }
    fun recheck() { main.removeCallbacks(tick); if (visible) main.post(tick) }

    private fun current(attempt: Int) = visible && generation == attempt && !activity.isFinishing && !activity.isDestroyed
    private fun schedule(delay: Long = 5_000) {
        main.removeCallbacks(tick)
        if (visible) main.postDelayed(tick, delay)
    }
    private fun check() {
        if (!visible || activity.isFinishing || activity.isDestroyed) return
        if (busy) { schedule(1_000); return }
        if (!EndpointReportingService.automaticEnabled(activity)) { schedule(); return }
        val local = DevicePreparationChecks.read(activity)
        if (!local.discoverySupported || !local.wifiConnected || !local.tailscaleInstalled) {
            schedule(); return
        }
        val stored = identities.load()
        // A phone used only for management must never claim or create a device.
        if (stored?.installationId == null || stored.generation == null) { schedule(); return }
        if (local.vpnPresent && EndpointReportingService.running && stored.activeSessionToken() != null) { schedule(); return }
        if (deniedToken != null && stored.sessionToken == deniedToken) { schedule(30_000); return }
        val attempt = generation
        busy = true
        worker.execute {
            var token: String? = null
            var eligible = false
            var transientFailure = false
            var rejectedToken: String? = null
            var verifiedScope: String? = null
            var restoreVpn = false
            try {
                var identity = identities.load() ?: error("Missing installation")
                require(identity.credential == stored.credential && identity.installationId == stored.installationId && identity.generation == stored.generation)
                if (identity.activeSessionToken() == null || refreshSession) {
                    val auth = association.bootstrap(identity.credential, bootstrapRequest)
                    require(auth.installationId.toString() == stored.installationId && auth.generation == stored.generation)
                    require(identities.load() == identity)
                    identity = identities.saveAuth(identity, auth)
                    refreshSession = false; bootstrapRequest = "automatic-session-${UUID.randomUUID()}"
                }
                token = requireNotNull(identity.activeSessionToken())
                val state = association.installationState(token)
                require(state.installationId.toString() == identity.installationId)
                if (state.deviceId != null && state.state in setOf("associated_pending_access", "access_ready")) {
                    val scope = "${identity.installationId}/${identity.generation}/${state.deviceId}"
                    if (!local.vpnPresent) {
                        // Restore only a previously server-verified current binding.
                        // First login/consent and switching another VPN are never automated.
                        restoreVpn = recovery.getString("verified_scope", null) == scope
                    } else {
                        val network = DeviceConnectionApiClient(http).installationState(token, state.deviceId)
                        require(network.factVersion == state.factVersion)
                        eligible = network.networkState in setOf("admitted", "pilot_verified")
                        if (eligible) verifiedScope = scope
                    }
                }
            } catch (error: ProviderApiException) {
                if (error.code in setOf("HTTP_401", "AUTHENTICATION_REQUIRED", "INVALID_CREDENTIALS")) refreshSession = true
                else if (error.code in setOf("HTTP_403", "AUTHORIZATION_DENIED", "AUTHORITY_CHANGED", "DEVICE_CONNECTION_SCOPE_REJECTED")) rejectedToken = token ?: stored.sessionToken
                transientFailure = true
            } catch (_: Exception) { transientFailure = true }
            main.post {
                busy = false
                if (current(attempt) && EndpointReportingService.automaticEnabled(activity)
                    && identities.load()?.activeSessionToken() == token) {
                    // Recheck local/system conditions after the asynchronous request.
                    val now = DevicePreparationChecks.read(activity)
                    verifiedScope?.let { recovery.edit().putString("verified_scope", it).apply() }
                    val elapsed = android.os.SystemClock.elapsedRealtime()
                    if (restoreVpn && now.wifiConnected && !now.vpnPresent && elapsed - lastVpnAttempt >= 30_000) {
                        lastVpnAttempt = elapsed
                        runCatching {
                            activity.sendBroadcast(Intent("com.tailscale.ipn.CONNECT_VPN")
                                .setComponent(ComponentName("com.tailscale.ipn", "com.tailscale.ipn.IPNReceiver"))
                                .addFlags(Intent.FLAG_RECEIVER_FOREGROUND))
                        }.onFailure { transientFailure = true }
                    }
                    if (eligible && now.wifiConnected && now.vpnPresent && now.wirelessDebugging == true && !EndpointReportingService.running) {
                        runCatching {
                            ContextCompat.startForegroundService(activity, Intent(activity, EndpointReportingService::class.java).setAction(EndpointReportingService.START))
                        }.onFailure { transientFailure = true }
                    }
                }
                if (current(attempt)) {
                    if (rejectedToken != null) deniedToken = rejectedToken
                    failures = if (transientFailure) failures + 1 else 0
                    schedule(if (transientFailure) (1_000L shl failures.coerceAtMost(5)).coerceAtMost(30_000) else 5_000)
                }
            }
        }
    }
}
