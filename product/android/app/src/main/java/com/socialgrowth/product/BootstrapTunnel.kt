package com.socialgrowth.product

import android.util.Base64
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.InetSocketAddress
import java.net.Socket
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Outgoing TLS only. No VPN or inbound phone listener. Only fresh local NSD
 * ports can be opened, always on loopback, never an address supplied remotely. */
internal class BootstrapTunnel(private val token: String) : AutoCloseable {
    companion object {
        private val client = OkHttpClient.Builder().pingInterval(10, TimeUnit.SECONDS)
            .connectTimeout(10, TimeUnit.SECONDS).readTimeout(0, TimeUnit.SECONDS)
            .followRedirects(false).followSslRedirects(false).build()
    }
    private data class LocalPorts(val pairing: Int?, val connect: Int?, val at: Long)
    private class Stream(val socket: Socket, val port: Int, val purpose: String) {
        val credit = Semaphore(1)
        val receiving = AtomicBoolean(false)
        val writer = Executors.newSingleThreadExecutor()
    }
    private val streams = ConcurrentHashMap<String, Stream>()
    private val readers = Executors.newFixedThreadPool(8)
    private val stopped = AtomicBoolean(false)
    @Volatile private var ports = LocalPorts(null, null, 0)
    @Volatile var handedOff = false
        private set
    @Volatile var sessionId: String? = null
        private set
    @Volatile private var socket: WebSocket? = null
    @Volatile private var connecting = false
    @Volatile private var nextAttempt = 0L
    private var failures = 0

    @Synchronized fun ensureConnected() {
        if (stopped.get() || handedOff || connecting || socket != null || android.os.SystemClock.elapsedRealtime() < nextAttempt) return
        connecting = true
        android.util.Log.i("SGConnection", "bootstrap_connecting")
        val origin = BuildConfig.API_BASE_URL.trimEnd('/')
        require(origin.startsWith("https://") || BuildConfig.DEBUG && origin.startsWith("http://"))
        val request = Request.Builder().url(origin.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://") + "/api/installation/bootstrap")
            .header("Authorization", "Installation $token").build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) { connecting = false }
            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    require(socket === webSocket && !stopped.get() && text.length <= 48000)
                    val message = JSONObject(text)
                    when (message.getString("type")) {
                        "managed" -> { handedOff = true; disconnected(webSocket) }
                        "ready" -> { sessionId = UUID.fromString(message.getString("sessionId")).toString(); failures = 0; android.util.Log.i("SGConnection", "bootstrap_ready") }
                        "open" -> open(message)
                        "close" -> closeStream(message.getString("id"), false)
                        "ack" -> streams[message.getString("id")]?.let { require(it.credit.availablePermits() == 0); it.credit.release() }
                        "data" -> receive(message)
                        else -> error("Protocol rejected")
                    }
                } catch (_: Exception) { android.util.Log.w("SGConnection", "bootstrap_frame_rejected"); disconnected(webSocket) }
            }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { android.util.Log.i("SGConnection", "bootstrap_closing code=$code"); disconnected(webSocket) }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                // Never log throwable messages, URLs, headers or wire content.
                android.util.Log.w("SGConnection", "bootstrap_failed category=${t.javaClass.simpleName} http=${response?.code ?: 0}")
                disconnected(webSocket)
            }
        })
    }
    fun update(snapshot: EndpointDiscoverySnapshot) {
        fun value(v: EndpointObservation) = if (snapshot.active && v.status == EndpointObservationStatus.CANDIDATE) v.port else null
        val next = LocalPorts(value(snapshot.pairing), value(snapshot.connect), android.os.SystemClock.elapsedRealtime())
        ports = next
        streams.forEach { (id, stream) -> if (stream.port != if (stream.purpose == "pairing") next.pairing else next.connect) closeStream(id) }
    }
    private fun send(message: JSONObject): Boolean {
        val ws = socket ?: return false
        if (ws.queueSize() > 512000 || !ws.send(message.toString())) { disconnected(ws); return false }
        return true
    }
    private fun open(message: JSONObject) {
        val id = UUID.fromString(message.getString("id")).toString()
        val purpose = message.getString("purpose")
        val port = message.getInt("port")
        val local = ports
        require(purpose in setOf("pairing", "connect") && port in 1..65535 && port == (if (purpose == "pairing") local.pairing else local.connect))
        require(android.os.SystemClock.elapsedRealtime() - local.at <= 15000 && streams.size < 8 && !streams.containsKey(id))
        val stream = Stream(Socket(), port, purpose)
        streams[id] = stream
        readers.execute {
            try {
                stream.socket.tcpNoDelay = true
                stream.socket.soTimeout = 60000
                stream.socket.connect(InetSocketAddress("127.0.0.1", port), 5000)
                val bytes = ByteArray(32768)
                while (!stopped.get() && streams[id] === stream) {
                    require(stream.credit.tryAcquire(60, TimeUnit.SECONDS))
                    val count = stream.socket.getInputStream().read(bytes)
                    if (count < 0) break
                    require(send(JSONObject().put("type", "data").put("id", id).put("data", Base64.encodeToString(bytes, 0, count, Base64.NO_WRAP))))
                }
            } catch (_: Exception) { /* Wire data, credentials and system errors never logged. */ }
            finally { closeStream(id) }
        }
    }
    private fun receive(message: JSONObject) {
        val id = message.getString("id")
        val stream = streams[id] ?: return
        val bytes = Base64.decode(message.getString("data"), Base64.NO_WRAP)
        require(bytes.size in 1..32768 && stream.receiving.compareAndSet(false, true))
        stream.writer.execute {
            try {
                // Open is queued before data, but TCP connect runs independently.
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
                while (!stream.socket.isConnected && streams[id] === stream && System.nanoTime() < deadline) Thread.sleep(10)
                require(stream.socket.isConnected && streams[id] === stream)
                stream.socket.getOutputStream().write(bytes)
                stream.receiving.set(false)
                send(JSONObject().put("type", "ack").put("id", id))
            } catch (_: Exception) { closeStream(id) }
        }
    }
    private fun closeStream(id: String, notify: Boolean = true) {
        val stream = streams.remove(id) ?: return
        runCatching { stream.socket.close() }; stream.credit.release(); stream.writer.shutdownNow()
        if (notify) send(JSONObject().put("type", "close").put("id", id))
    }
    @Synchronized private fun disconnected(ws: WebSocket) {
        if (socket !== ws) return
        socket = null; sessionId = null; connecting = false; ws.cancel()
        streams.keys.toList().forEach { closeStream(it, false) }
        failures = (failures + 1).coerceAtMost(5)
        nextAttempt = android.os.SystemClock.elapsedRealtime() + (1000L shl failures)
    }
    override fun close() {
        stopped.set(true); socket?.let { disconnected(it) }; readers.shutdownNow()
    }
}
