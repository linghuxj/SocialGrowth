package com.socialgrowth.product

import org.json.JSONObject
import java.math.BigDecimal
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.UUID

internal data class DeviceControlFact(
    val deviceId: UUID,
    val requestId: String?,
    val intent: String,
    val controlVersion: Long?,
    val controlGeneration: String?,
    val stop: String,
    val unresolvedActionCount: Int,
    val checkedAt: Instant,
)

internal data class DeviceControlRequest(val requestId: String, val idempotencyKey: String) {
    companion object {
        fun create() = DeviceControlRequest(
            requestId = "android-control-${UUID.randomUUID()}",
            idempotencyKey = "android-control-${UUID.randomUUID()}",
        )
    }
}

internal class DeviceControlApiClient(baseUrl: String) {
    private companion object {
        const val CONTRACT_VERSION = "2026-09-29.identity-v1"
    }
    private val base = URL(baseUrl).also {
        require(it.protocol in setOf("http", "https") && it.userInfo == null && it.query == null && it.ref == null)
        require(it.host.isNotBlank() && it.path in setOf("", "/"))
    }.toString().trimEnd('/')

    fun provider(deviceId: UUID, token: String) = request(
        "GET", "/api/provider/devices/$deviceId/control", token,
    ).let(::parse).also { require(it.deviceId == deviceId) { "Control response target mismatch" } }

    fun installation(token: String, expectedDeviceId: UUID) = request(
        "GET", "/api/installation/self/control", token,
    ).let(::parse).also { require(it.deviceId == expectedDeviceId) { "Control response target mismatch" } }

    fun pauseProvider(deviceId: UUID, token: String, request: DeviceControlRequest) = post(
        "/api/provider/devices/$deviceId/control/pause", token, request, deviceId,
    )

    fun resumeProvider(deviceId: UUID, token: String, request: DeviceControlRequest) = post(
        "/api/provider/devices/$deviceId/control/resume", token, request, deviceId,
    )

    fun pauseInstallation(token: String, expectedDeviceId: UUID, request: DeviceControlRequest) = post(
        "/api/installation/self/control/pause", token, request, expectedDeviceId,
    )

    private fun post(path: String, token: String, request: DeviceControlRequest, expectedDeviceId: UUID): DeviceControlFact {
        require(request.requestId.matches(Regex("^[A-Za-z0-9_-]{8,128}$")))
        require(request.idempotencyKey.matches(Regex("^[A-Za-z0-9_-]{8,128}$")))
        val body = JSONObject().put(
            "metadata",
            JSONObject()
                .put("contractVersion", ProviderApiClient.CONTRACT_VERSION)
                .put("requestId", request.requestId)
                .put("idempotencyKey", request.idempotencyKey),
        )
        return parse(request("POST", path, token, body)).also {
            require(it.deviceId == expectedDeviceId) { "Control response target mismatch" }
            require(it.requestId == request.requestId) { "Control response request ID mismatch" }
        }
    }

    private fun request(method: String, path: String, token: String, body: JSONObject? = null): String {
        require(path.startsWith("/api/provider/devices/") || path.startsWith("/api/installation/self/"))
        require(token.matches(Regex("^[A-Za-z0-9_-]{43}$")))
        val connection = URL(base + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = method
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 8_000
            connection.readTimeout = 10_000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { it.readAtMost(16_385) } ?: error("Missing control response")
            require(bytes.size <= 16_384) { "Control response exceeds the limit" }
            val raw = String(bytes, Charsets.UTF_8)
            if (status !in 200..299) throw DeviceControlRequestException(status, safeErrorCode(raw))
            return raw
        } finally {
            connection.disconnect()
        }
    }

    internal fun parse(raw: String): DeviceControlFact = try {
        val json = JSONObject(raw)
        require(json.keys().asSequence().toSet() == setOf(
            "contractVersion", "deviceId", "requestId", "intent", "controlVersion", "controlGeneration",
            "stop", "unresolvedActionCount", "checkedAt",
        ))
        require(string(json, "contractVersion") == CONTRACT_VERSION)
        val deviceId = UUID.fromString(string(json, "deviceId"))
        val requestId = if (json.isNull("requestId")) null else string(json, "requestId").also {
            require(it.matches(Regex("^[A-Za-z0-9_-]{8,128}$")))
        }
        val intent = string(json, "intent").also {
            require(it in setOf("active", "pause_requested", "paused", "resume_requested", "exit_pending", "exited"))
        }
        val controlVersion = if (json.isNull("controlVersion")) null else safeLong(json.get("controlVersion"))
        val controlGeneration = if (json.isNull("controlGeneration")) null else string(json, "controlGeneration").also {
            require(it.matches(Regex("^[1-9][0-9]{0,18}$")))
        }
        val stop = string(json, "stop").also {
            require(it in setOf("not_requested", "requested", "confirmed", "unknown"))
        }
        val unresolved = safeLong(json.get("unresolvedActionCount"))
        require(unresolved in 0..Int.MAX_VALUE.toLong())
        if (stop != "not_requested") require(controlVersion != null && controlGeneration != null)
        if (stop == "confirmed") require(unresolved == 0L)
        DeviceControlFact(
            deviceId, requestId, intent, controlVersion, controlGeneration, stop,
            unresolved.toInt(), Instant.parse(string(json, "checkedAt")),
        )
    } catch (_: Exception) {
        throw IllegalStateException("Invalid device control response")
    }

    private fun safeLong(value: Any): Long {
        require(value is Number)
        return BigDecimal(value.toString()).longValueExact().also { require(it in 0..9_007_199_254_740_991L) }
    }

    private fun string(json: JSONObject, key: String): String = json.get(key) as? String
        ?: error("Control field is not a string")

    private fun safeErrorCode(raw: String): String = try {
        JSONObject(raw).getJSONObject("error").optString("code").take(64)
    } catch (_: Exception) { "HTTP_ERROR" }
}

internal class DeviceControlRequestException(val status: Int, val code: String) : Exception()
