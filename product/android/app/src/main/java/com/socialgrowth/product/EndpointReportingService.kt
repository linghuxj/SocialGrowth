package com.socialgrowth.product

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
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

/** User-started discovery reporting; no pairing secrets or business action lease.
 * Visible and non-sticky; user stop/session change ends the connection check.
 */
class EndpointReportingService : Service() {
    companion object {
        const val START = "com.socialgrowth.product.REPORT_ENDPOINTS"
        const val STOP = "com.socialgrowth.product.STOP_ENDPOINT_REPORTS"
        @Volatile var running = false
            private set
        @Volatile private var status = "连接检查未开启"
        fun statusText() = status
    }
    private val live = AtomicBoolean(false)
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
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
        if (intent?.action == STOP) { shutdown(); return START_NOT_STICKY }
        if (intent?.action != START || Build.VERSION.SDK_INT < 34) {
            shutdown(); return START_NOT_STICKY
        }
        if (stopping) { stopSelf(); return START_NOT_STICKY }
        if (live.get()) return START_NOT_STICKY
        try {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel("endpoint-reporting", "远程连接检查", NotificationManager.IMPORTANCE_LOW))
            val stop = PendingIntent.getService(this, 2, Intent(this, EndpointReportingService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE)
            val notification = Notification.Builder(this, "endpoint-reporting").setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("SocialGrowth 正在保持连接").setContentText("正在帮助平台连接本机，可随时停止连接检查。")
                .setOngoing(true).addAction(Notification.Action.Builder(null, "停止连接检查", stop).build()).build()
            startForeground(2402, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
            originalToken = InstallationIdentityStore(this).load()?.activeSessionToken()
            require(originalToken != null)
            discovery = NativeEndpointDiscovery(this).also { it.startForegroundWindow() }
            live.set(true); running = true; status = "正在检查远程连接"
            main.post(tick)
        } catch (_: Exception) { shutdown() }
        return START_NOT_STICKY
    }
    private fun cycle() {
        if (!live.get() || busy) return
        if (InstallationIdentityStore(this).load()?.activeSessionToken() != originalToken) {
            shutdown(); return
        }
        busy = true
        val snapshot = discovery!!.snapshot()
        val capturedAt = Instant.now().toString()
        val http = ProviderApiClient(BuildConfig.API_BASE_URL)
        worker.execute {
            var success = false
            var fatal = false
            try {
                val token = requireNotNull(originalToken)
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
                if (e.code in setOf("HTTP_409", "FACT_VERSION_STALE")) {
                    epoch = null; pending = null; sequence = 0; epochRequestId = UUID.randomUUID().toString()
                }
                fatal = e.code in setOf("HTTP_401", "HTTP_403", "AUTHENTICATION_REQUIRED", "PILOT_DEVICE_NOT_ALLOWED", "DEVICE_CONNECTION_SCOPE_REJECTED")
            } catch (_: Exception) { /* No token, body, system cause or pairing code logging. */ }
            main.post {
                busy = false
                if (!live.get()) return@post
                if (fatal) { shutdown(); return@post }
                failures = if (success) 0 else failures + 1
                status = if (success) "正在保持连接，请按页面提示继续" else "暂时联系不上平台，正在重试"
                // Stop retrying a report after its bounded observation validity.
                if (!success && pending != null && Instant.now().toEpochMilli() - Instant.parse(pending!!.getString("observedAt")).toEpochMilli() >= 10_000) pending = null
                if (discovery?.snapshot()?.active == false) discovery?.startForegroundWindow()
                val delay = if (success) 3000L else (1000L shl failures.coerceAtMost(5)).coerceAtMost(30_000L)
                main.postDelayed(tick, delay)
            }
        }
    }
    private fun shutdown() {
        if (stopping) return
        stopping = true
        live.set(false); running = false; status = "连接检查已停止"
        main.removeCallbacks(tick); discovery?.close(); discovery = null
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
    override fun onDestroy() { live.set(false); running = false; main.removeCallbacks(tick); discovery?.close(); worker.shutdown(); super.onDestroy() }
}
