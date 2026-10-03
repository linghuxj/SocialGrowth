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
import android.os.SystemClock
import org.json.JSONObject
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Independent HTTPS telemetry: no ADB transport, code, admission or action lease.
 * Diagnostic builds only; explicit visible start, bounded lifetime, non-sticky.
 */
class EndpointReportingService : Service() {
    companion object {
        const val START = "com.socialgrowth.product.REPORT_ENDPOINTS"
        const val STOP = "com.socialgrowth.product.STOP_ENDPOINT_REPORTS"
        @Volatile var running = false
            private set
        @Volatile private var status = "端口上报未开启"
        fun statusText() = status
    }
    private val live = AtomicBoolean(false)
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var discovery: NativeEndpointDiscovery? = null
    private var pending: JSONObject? = null // A lost ACK retries exactly the same report.
    private var stopping = false
    private var busy = false
    private var deadline = 0L
    private var epoch: String? = null
    private var sequence = 0L
    private var failures = 0
    private val epochRequestId = UUID.randomUUID().toString()
    private var originalToken: String? = null
    private val tick = Runnable { cycle() }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == STOP) { shutdown(); return START_NOT_STICKY }
        if (intent?.action != START || !BuildConfig.ENDPOINT_DIAGNOSTICS || Build.VERSION.SDK_INT < 34) {
            shutdown(); return START_NOT_STICKY
        }
        if (stopping) { stopSelf(); return START_NOT_STICKY }
        if (live.get()) return START_NOT_STICKY
        try {
            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(NotificationChannel("endpoint-reporting", "远程连接端口上报", NotificationManager.IMPORTANCE_LOW))
            val stop = PendingIntent.getService(this, 2, Intent(this, EndpointReportingService::class.java).setAction(STOP), PendingIntent.FLAG_IMMUTABLE)
            val notification = Notification.Builder(this, "endpoint-reporting").setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("SocialGrowth 端口自动上报").setContentText("仅报告远程连接候选；不代表任务执行许可。")
                .setOngoing(true).addAction(Notification.Action.Builder(null, "停止上报", stop).build()).build()
            startForeground(2402, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
            originalToken = InstallationIdentityStore(this).load()?.activeSessionToken()
            require(originalToken != null)
            deadline = SystemClock.elapsedRealtime() + 60 * 60_000L
            discovery = NativeEndpointDiscovery(this).also { it.startForegroundWindow() }
            live.set(true); running = true; status = "正在发现并上报远程连接端口"
            main.post(tick)
        } catch (_: Exception) { shutdown() }
        return START_NOT_STICKY
    }
    private fun cycle() {
        if (!live.get() || busy) return
        if (SystemClock.elapsedRealtime() >= deadline || InstallationIdentityStore(this).load()?.activeSessionToken() != originalToken) {
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
                    val response = JSONObject(http.post("/diagnostics/endpoint/epoch", JSONObject().put("requestId", epochRequestId), token))
                    require(response.keys().asSequence().toSet() == setOf("epoch"))
                    epoch = response.getString("epoch").also { UUID.fromString(it) }
                }
                if (pending == null) {
                    fun observation(value: EndpointObservation) = JSONObject().put("status", value.status.name.lowercase())
                        .put("port", value.port ?: JSONObject.NULL)
                    pending = JSONObject().put("protocolVersion", "remote-adb-diagnostic-v1").put("epoch", epoch)
                        .put("reportId", UUID.randomUUID().toString()).put("sequence", ++sequence)
                        .put("observedAt", java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.parse(capturedAt)))
                        .put("connect", observation(snapshot.connect)).put("pairing", observation(snapshot.pairing))
                }
                val report = requireNotNull(pending)
                val receipt = JSONObject(http.post("/diagnostics/endpoint/report", report, token))
                require(receipt.keys().asSequence().toSet() == setOf("epoch", "reportId", "sequence", "acceptedAt"))
                require(receipt.getString("epoch") == epoch && receipt.getString("reportId") == report.getString("reportId") && receipt.getLong("sequence") == sequence)
                Instant.parse(receipt.getString("acceptedAt"))
                pending = null; success = true
            } catch (e: ProviderApiException) {
                fatal = e.code in setOf("HTTP_401", "HTTP_403", "AUTHENTICATION_REQUIRED", "DIAGNOSTIC_SCOPE_REJECTED")
            } catch (_: Exception) { /* No token, body, system cause or pairing code logging. */ }
            main.post {
                busy = false
                if (!live.get()) return@post
                if (fatal) { shutdown(); return@post }
                failures = if (success) 0 else failures + 1
                status = if (success) "端口快照已上报；连接需中心核验" else "端口上报待重试；旧候选不会延长有效期"
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
        live.set(false); running = false; status = "端口上报已停止；旧候选将失效"
        main.removeCallbacks(tick); discovery?.close(); discovery = null
        // Single worker ordering ensures this withdrawal follows any in-flight
        // report. Best effort only: absence of ACK never grants freshness.
        if (!worker.isShutdown) worker.execute {
            try {
                val currentEpoch = epoch ?: return@execute
                val token = originalToken ?: return@execute
                val stopped = JSONObject().put("status", "stopped").put("port", JSONObject.NULL)
                val report = JSONObject().put("protocolVersion", "remote-adb-diagnostic-v1").put("epoch", currentEpoch)
                    .put("reportId", UUID.randomUUID().toString()).put("sequence", ++sequence)
                    .put("observedAt", java.time.format.DateTimeFormatterBuilder().appendInstant(3).toFormatter().format(Instant.now()))
                    .put("connect", stopped).put("pairing", stopped)
                ProviderApiClient(BuildConfig.API_BASE_URL).post("/diagnostics/endpoint/report", report, token)
            } catch (_: Exception) { /* Old candidate expires at the center. */ }
        }
        stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
    override fun onDestroy() { live.set(false); running = false; main.removeCallbacks(tick); discovery?.close(); worker.shutdown(); super.onDestroy() }
}
