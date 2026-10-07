package com.socialgrowth.product

import org.json.JSONObject
import java.time.Instant
import java.util.UUID

internal data class DeviceConnectionSnapshot(
    val deviceId: UUID,
    val factVersion: Long,
    val networkState: String,
    val pairingState: String,
    val connectionState: String,
    val blockerCode: String?,
    val pairingExpiresAt: Instant?,
    val endpointObservedAt: Instant?,
) {
    val connected: Boolean get() = networkState in setOf("admitted", "managed_verified", "pilot_verified", "bootstrap") && connectionState == "connected"
}

internal object DeviceConnectionBoundary {
    const val VERSION = "device-connection-v1"
    fun snapshot(raw: String, expectedDevice: UUID): DeviceConnectionSnapshot {
        try {
            val j = JSONObject(raw)
            require(j.getString("protocolVersion") == VERSION)
            val device = UUID.fromString(j.getString("deviceId"))
            require(device == expectedDevice)
            val version = java.math.BigDecimal(j.get("factVersion").toString()).longValueExact()
            require(version in 1..9007199254740991L)
            val network = j.getString("networkState")
            val pairing = j.getString("pairingState")
            val connection = j.getString("connectionState")
            require(network in setOf("not_configured", "pending", "admitted", "managed_verified", "pilot_verified", "bootstrap", "blocked", "unknown"))
            require(pairing in setOf("not_started", "awaiting_code", "pairing", "paired", "expired", "unknown"))
            require(connection in setOf("not_connected", "connecting", "connected", "stale", "unknown"))
            require(connection != "connected" || network in setOf("admitted", "managed_verified", "pilot_verified", "bootstrap"))
            fun time(key: String): Instant? = if (j.isNull(key)) null else Instant.parse(j.getString(key))
            val blocker = if (j.isNull("blockerCode")) null else j.getString("blockerCode").also { require(it.matches(Regex("^[A-Z0-9_]{1,100}$"))) }
            return DeviceConnectionSnapshot(device, version, network, pairing, connection, blocker, time("pairingExpiresAt"), time("endpointObservedAt"))
        } catch (_: Exception) { throw ContractBoundaryException("Invalid device connection state") }
    }
    fun message(state: DeviceConnectionSnapshot): String = when {
        state.connected && state.networkState == "bootstrap" -> "首次连接成功，可由运营从 Web 发起手机准备；请保持 App 通知运行。"
        state.connected -> "平台已连接到这台手机。"
        state.blockerCode == "NETWORK_AUTHORITY_UNAVAILABLE" -> "平台暂时无法核对本机网络，请联系运营处理。已完成的手机设置无需重做。"
        state.networkState == "not_configured" -> "平台的网络接入尚未配置，请联系邀请你的运营人员。"
        state.networkState == "blocked" -> "本机入网暂未通过，请联系邀请你的运营人员核对。"
        state.networkState !in setOf("admitted", "managed_verified", "pilot_verified", "bootstrap") -> "等待本机完成网络接入。"
        state.pairingState == "pairing" -> "正在配对，请保持执行手机的配对弹窗打开。"
        state.pairingState == "awaiting_code" -> "已找到执行手机。同机使用请在 SocialGrowth 通知中输入配对码；其他手机可在管理页输入。"
        state.pairingState == "expired" -> "配对已超时，请在执行手机重新打开配对码。"
        state.connectionState == "connecting" -> "正在连接，请稍候。"
        state.connectionState == "stale" -> "连接暂时中断，正在等待执行手机重新连接。"
        state.pairingState == "unknown" -> "上次配对结果待核实，请先刷新检查，暂勿重复提交。"
        state.pairingState == "paired" -> "已配对，但当前连接尚未确认。请检查 Wi-Fi，并保持连接检查开启；无需重复输入配对码。"
        else -> "请在执行手机开启无线调试，并打开配对码弹窗。"
    }
}

internal class DeviceConnectionApiClient(private val http: ProviderApiClient) {
    private fun body() = JSONObject().put("protocolVersion", DeviceConnectionBoundary.VERSION)
        .put("requestId", UUID.randomUUID().toString())

    fun installationState(token: String, deviceId: UUID): DeviceConnectionSnapshot = DeviceConnectionBoundary.snapshot(
        http.post("/api/installation/device-connection/state", body(), token), deviceId)

    fun providerState(token: String, deviceId: UUID): DeviceConnectionSnapshot = DeviceConnectionBoundary.snapshot(
        http.post("/api/provider/device-connection/state", body().put("deviceId", deviceId.toString()), token), deviceId)

    fun pair(token: String, device: DeviceConnectionSnapshot, code: String, requestId: String) {
        require(code.matches(Regex("^[0-9]{6}$")))
        // Keep the code only in the outgoing request. Never save it in UI state,
        // preferences, the retry identity, notifications or diagnostic output.
        val response = JSONObject(http.post("/api/provider/device-connection/pair", body().put("requestId", requestId)
            .put("idempotencyKey", requestId).put("deviceId", device.deviceId.toString())
            .put("expectedFactVersion", device.factVersion).put("pairingCode", code), token))
        require(response.getString("requestId") == requestId && UUID.fromString(response.getString("deviceId")) == device.deviceId)
    }
}
