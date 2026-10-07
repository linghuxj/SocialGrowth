package com.socialgrowth.product

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import org.json.JSONObject
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Foreground discovery reporting; pairing input is transient, never stored.
 * Visible and non-sticky; explicit user pause is retained across App launches.
 */
class EndpointReportingService : Service() {
    companion object {
        const val START = "com.socialgrowth.product.REPORT_ENDPOINTS"
        const val STOP = "com.socialgrowth.product.STOP_ENDPOINT_REPORTS"
        private const val PAIR = "com.socialgrowth.product.PAIR_LOCAL_FROM_NOTIFICATION"
        private const val PAIR_CODE = "pairing_code"
        fun automaticEnabled(context: android.content.Context) = context.getSharedPreferences("endpoint_connection", android.content.Context.MODE_PRIVATE).getBoolean("automatic_enabled", true)
        fun setAutomaticEnabled(context: android.content.Context, enabled: Boolean) {
            check(context.getSharedPreferences("endpoint_connection", android.content.Context.MODE_PRIVATE).edit().putBoolean("automatic_enabled", enabled).commit())
        }
        @Volatile var running = false
            private set
        @Volatile private var status = "连接检查未开启"
        fun statusText() = status
    }
    private val live = AtomicBoolean(false)
    private val pairing = AtomicBoolean(false)
    private var pairingFeedback: String? = null
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private val pairWorker = Executors.newSingleThreadExecutor()
    @Volatile private var tunnel: BootstrapTunnel? = null
    private var choseTransport = false
    private var tunnelSession: String? = null
    private var discovery: NativeEndpointDiscovery? = null
    private var pending: JSONObject? = null // A lost ACK retries exactly the same report.
    private var stopping = false
    private var busy = false
    private var epoch: String? = null
    private var sequence = 0L
    private var failures = 0
    private var epochRequestId = UUID.randomUUID().toString()
    private var originalToken: String? = null
    private val tick = Runnable { cycle() }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) { setAutomaticEnabled(this, false); shutdown(); return START_NOT_STICKY }
        if (intent?.action == PAIR) {
            val code = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(PAIR_CODE)?.toString()
            intent.clipData = null
            if (code?.matches(Regex("^[0-9]{6}$")) == true) pairFromNotification(code)
            else if (live.get()) {
                pairingFeedback = "请输入系统弹窗显示的 6 位配对码。"
                refreshNotification()
            } else stopSelf()
            return START_NOT_STICKY
        }
        if (intent?.action != START || Build.VERSION.SDK_INT < 34 || !automaticEnabled(this)) {
            shutdown(); return START_NOT_STICKY
        }
        if (stopping) { stopSelf(); return START_NOT_STICKY }
        if (live.get()) {
            // The service can predate notification permission. An explicit
            // prepare/retry must repost it without replacing the live tunnel.
            refreshNotification()
            return START_NOT_STICKY
        }
        try {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel("endpoint-reporting", "远程连接检查", NotificationManager.IMPORTANCE_LOW))
            startForeground(2402, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
            originalToken = InstallationIdentityStore(this).load()?.activeSessionToken()
            require(originalToken != null)
            discovery = NativeEndpointDiscovery(this).also { it.startForegroundWindow() }
            live.set(true); running = true; status = "正在检查远程连接"
            main.post(tick)
        } catch (_: Exception) { shutdown() }
        return START_NOT_STICKY
    }

    private fun notification(): Notification {
        val stop = PendingIntent.getService(this, 2, Intent(this, EndpointReportingService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE)
        val builder = Notification.Builder(this, "endpoint-reporting").setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("SocialGrowth 正在保持连接")
            .setContentText(pairingFeedback ?: "首次配对：保持系统弹窗打开，在此输入配对码。")
            .setVisibility(Notification.VISIBILITY_PRIVATE).setOnlyAlertOnce(true).setOngoing(true)
        if (Build.VERSION.SDK_INT >= 31) builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        if (ProviderSessionStore(this).load() != null && !pairing.get()) {
            val reply = PendingIntent.getService(this, 3, Intent(this, EndpointReportingService::class.java).setAction(PAIR), PendingIntent.FLAG_MUTABLE)
            val action = Notification.Action.Builder(null, "输入配对码", reply)
                .addRemoteInput(RemoteInput.Builder(PAIR_CODE).setLabel("6 位配对码").build())
            if (Build.VERSION.SDK_INT >= 31) action.setAuthenticationRequired(true)
            builder.addAction(action.build())
        }
        return builder.addAction(Notification.Action.Builder(null, "暂停自动连接", stop).build()).build()
    }

    private fun refreshNotification() {
        if (live.get()) getSystemService(NotificationManager::class.java).notify(2402, notification())
    }

    private fun pairFromNotification(code: String) {
        val token = originalToken
        if (!live.get() || stopping || token == null) { if (!live.get()) stopSelf(); return }
        if (!pairing.compareAndSet(false, true)) return
        pairingFeedback = "正在核对本机并配对，请保持系统弹窗打开…"
        refreshNotification()
        pairWorker.execute {
            val feedback = try {
                require(live.get() && InstallationIdentityStore(this).load()?.activeSessionToken() == token)
                val session = ProviderSessionStore(this).load() ?: error("Management login required")
                val http = ProviderApiClient(BuildConfig.API_BASE_URL)
                val installation = AssociationApiClient(http).installationState(token)
                val client = DeviceConnectionApiClient(http)
                val fact = client.providerState(session.sessionToken, requireNotNull(installation.deviceId))
                when {
                    fact.connected -> "平台已连接到这台手机，无需重复配对。"
                    fact.networkState !in setOf("admitted", "managed_verified", "pilot_verified", "bootstrap") || fact.pairingState != "awaiting_code" -> DeviceConnectionBoundary.message(fact)
                    else -> {
                        require(live.get() && InstallationIdentityStore(this).load()?.activeSessionToken() == token
                            && ProviderSessionStore(this).load()?.sessionToken == session.sessionToken)
                        // One explicit submission. Lost ACK is reconciled from
                        // state, never retried with the secret or a new request.
                        client.pair(session.sessionToken, fact, code, "notification-pair-${UUID.randomUUID()}")
                        DeviceConnectionBoundary.message(client.providerState(session.sessionToken, fact.deviceId))
                    }
                }
            } catch (_: Exception) {
                "配对结果尚未确认，请返回 App 检查，暂勿重复提交。"
            }
            main.post {
                pairing.set(false)
                pairingFeedback = feedback
                refreshNotification()
            }
        }
    }
    private fun cycle() {
        if (Build.VERSION.SDK_INT < 34) { shutdown(); return }
        if (!live.get() || busy) return
        if (InstallationIdentityStore(this).load()?.activeSessionToken() != originalToken) {
            shutdown(); return
        }
        val snapshot = discovery!!.snapshot()
        tunnel?.update(snapshot)
        tunnel?.ensureConnected()
        val session = tunnel?.sessionId
        if (session != tunnelSession) {
            tunnelSession = session; epoch = null; pending = null; sequence = 0; epochRequestId = UUID.randomUUID().toString()
        }
        busy = true
        val capturedAt = Instant.now().toString()
        val http = ProviderApiClient(BuildConfig.API_BASE_URL)
        worker.execute {
            var success = false
            var fatal = false
            try {
                val token = requireNotNull(originalToken)
                if (!choseTransport) {
                    val local = AssociationApiClient(http).installationState(token)
                    val fact = DeviceConnectionApiClient(http).installationState(token, requireNotNull(local.deviceId))
                    if (fact.networkState !in setOf("admitted", "pilot_verified", "managed_verified")) {
                        tunnel?.close()
                        tunnel = BootstrapTunnel(token).also { it.update(snapshot); it.ensureConnected() }
                    }
                    choseTransport = true
                }
                if (tunnel != null && tunnel?.handedOff != true && tunnel?.sessionId == null) error("Waiting for authenticated transport")
                if (epoch == null) {
                    val response = JSONObject(http.post("/api/installation/device-connection/epoch", JSONObject().put("protocolVersion", DeviceConnectionBoundary.VERSION).put("requestId", epochRequestId), token))
                    require(response.getString("protocolVersion") == DeviceConnectionBoundary.VERSION)
                    require(response.getString("sequence") == "0")
                    epoch = response.getString("sourceEpoch").also { UUID.fromString(it) }
                }
                if (pending == null) {
                    fun observation(value: EndpointObservation): JSONObject {
                        val status = when (value.status) {
                            EndpointObservationStatus.CANDIDATE -> "candidate"
                            EndpointObservationStatus.LOST, EndpointObservationStatus.STOPPED -> "withdrawn"
                            else -> "unknown"
                        }
                        return JSONObject().put("status", status).put("port", if (status == "candidate") value.port else JSONObject.NULL)
                    }
                    pending = JSONObject().put("protocolVersion", DeviceConnectionBoundary.VERSION).put("sourceEpoch", epoch)
                        .put("requestId", UUID.randomUUID().toString()).put("sequence", (++sequence).toString())
                        .put("observedAt", java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.parse(capturedAt)))
                        .put("connect", observation(snapshot.connect)).put("pairing", observation(snapshot.pairing))
                }
                val report = requireNotNull(pending)
                val receipt = JSONObject(http.post("/api/installation/device-connection/report", report, token))
                require(receipt.getString("protocolVersion") == DeviceConnectionBoundary.VERSION)
                require(receipt.getString("sourceEpoch") == epoch && receipt.getString("sequence") == sequence.toString())
                Instant.parse(receipt.getString("acceptedAt"))
                pending = null; success = true
            } catch (e: ProviderApiException) {
                if (failures == 0) android.util.Log.w("SGConnection", "report_rejected code=${e.code.takeIf { it.matches(Regex("^[A-Z0-9_]{1,100}$")) } ?: "UNKNOWN"}")
                if (e.code in setOf("HTTP_409", "FACT_VERSION_STALE")) {
                    epoch = null; pending = null; sequence = 0; epochRequestId = UUID.randomUUID().toString()
                }
                if (e.code in setOf("HTTP_403", "AUTHORIZATION_DENIED") && (tunnel == null || tunnel?.handedOff == true)) {
                    // Recheck authority before falling back; a revoked association
                    // cannot open a new authenticated bootstrap session.
                    choseTransport = false; epoch = null; pending = null; sequence = 0
                    epochRequestId = UUID.randomUUID().toString()
                }
                fatal = e.code in setOf("HTTP_401", "HTTP_403", "AUTHENTICATION_REQUIRED", "PILOT_DEVICE_NOT_ALLOWED", "DEVICE_CONNECTION_SCOPE_REJECTED")
            } catch (e: Exception) {
                if (failures == 0) android.util.Log.w("SGConnection", "report_failed category=${e.javaClass.simpleName}")
            }
            main.post {
                busy = false
                if (!live.get()) return@post
                if (fatal) { shutdown(); return@post }
                failures = if (success) 0 else failures + 1
                status = if (success) "正在保持连接，请按页面提示继续" else "暂时联系不上平台，正在重试"
                // Stop retrying a report after its bounded observation validity.
                if (!success && pending != null && Instant.now().toEpochMilli() - Instant.parse(pending!!.getString("observedAt")).toEpochMilli() >= 10_000) pending = null
                if (Build.VERSION.SDK_INT >= 34 && discovery?.snapshot()?.active == false) discovery?.startForegroundWindow()
                val delay = if (success) 3000L else (1000L shl failures.coerceAtMost(5)).coerceAtMost(30_000L)
                main.postDelayed(tick, delay)
            }
        }
    }
    private fun shutdown() {
        if (stopping) return
        stopping = true
        live.set(false); running = false; status = "连接检查已停止"
        main.removeCallbacks(tick); tunnel?.close(); tunnel = null; if (Build.VERSION.SDK_INT >= 34) discovery?.close(); discovery = null
        // Single worker ordering ensures this withdrawal follows any in-flight
        // report. Best effort only: absence of ACK never grants freshness.
        if (!worker.isShutdown) worker.execute {
            try {
                val currentEpoch = epoch ?: return@execute
                val token = originalToken ?: return@execute
                val stopped = JSONObject().put("status", "withdrawn").put("port", JSONObject.NULL)
                val report = JSONObject().put("protocolVersion", DeviceConnectionBoundary.VERSION).put("sourceEpoch", currentEpoch)
                    .put("requestId", UUID.randomUUID().toString()).put("sequence", (++sequence).toString())
                    .put("observedAt", java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.now()))
                    .put("connect", stopped).put("pairing", stopped)
                ProviderApiClient(BuildConfig.API_BASE_URL).post("/api/installation/device-connection/report", report, token)
            } catch (_: Exception) { /* Old candidate expires at the center. */ }
        }
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
    override fun onDestroy() { live.set(false); running = false; main.removeCallbacks(tick); tunnel?.close(); tunnel = null; if (Build.VERSION.SDK_INT >= 34) discovery?.close(); worker.shutdown(); pairWorker.shutdown(); super.onDestroy() }
}
