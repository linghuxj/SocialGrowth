package com.socialgrowth.product

import android.content.Context
import org.json.JSONObject
import java.util.UUID

internal data class ProviderDeviceLabelCommand(
    val providerId: String,
    val deviceId: UUID,
    val expectedFactVersion: Long,
    val displayName: String,
    val contractVersion: String,
    val requestId: String,
    val idempotencyKey: String,
) {
    companion object {
        fun create(providerId: String, device: ProviderDevice, displayName: String): ProviderDeviceLabelCommand =
            ProviderDeviceLabelCommand(
                providerId = providerId,
                deviceId = device.deviceId,
                expectedFactVersion = device.factVersion,
                displayName = displayName.trim(),
                contractVersion = ProviderApiClient.CONTRACT_VERSION,
                requestId = "android-device-label-${UUID.randomUUID()}",
                idempotencyKey = "device-label-${UUID.randomUUID()}",
            )
    }
}

/** Persists only an unresolved label command; no session credentials are stored here. */
internal class ProviderDeviceLabelCommandStore(context: Context) {
    private val preferences = context.getSharedPreferences("provider_device_label_commands", Context.MODE_PRIVATE)

    fun load(providerId: String, deviceId: UUID): ProviderDeviceLabelCommand? {
        val raw = preferences.getString(key(providerId, deviceId), null) ?: return null
        val json = JSONObject(raw)
        require(json.keys().asSequence().toSet() == setOf(
            "providerId", "deviceId", "expectedFactVersion", "displayName", "contractVersion", "requestId", "idempotencyKey",
        ))
        val command = ProviderDeviceLabelCommand(
            providerId = json.getString("providerId").also { UUID.fromString(it) },
            deviceId = UUID.fromString(json.getString("deviceId")),
            expectedFactVersion = json.getLong("expectedFactVersion").also { require(it >= 0) },
            displayName = json.getString("displayName").also { require(it.trim() == it && it.isNotEmpty() && it.length <= 100) },
            contractVersion = json.getString("contractVersion").also { require(it.matches(Regex("^[A-Za-z0-9_.-]{1,100}$"))) },
            requestId = json.getString("requestId").also { require(it.matches(Regex("^[A-Za-z0-9_-]{1,128}$"))) },
            idempotencyKey = json.getString("idempotencyKey").also { require(it.matches(Regex("^[A-Za-z0-9_-]{8,128}$"))) },
        )
        require(command.providerId == providerId && command.deviceId == deviceId)
        return command
    }

    @Synchronized
    fun save(command: ProviderDeviceLabelCommand): Boolean {
        val pendingKey = key(command.providerId, command.deviceId)
        if (preferences.contains(pendingKey)) return false
        return preferences.edit()
        .putString(pendingKey, JSONObject()
            .put("providerId", command.providerId.toString())
            .put("deviceId", command.deviceId.toString())
            .put("expectedFactVersion", command.expectedFactVersion)
            .put("displayName", command.displayName)
            .put("contractVersion", command.contractVersion)
            .put("requestId", command.requestId)
            .put("idempotencyKey", command.idempotencyKey)
            .toString())
        .commit()
    }

    @Synchronized
    fun clear(command: ProviderDeviceLabelCommand): Boolean {
        if (!preferences.contains(key(command.providerId, command.deviceId))) return false
        val current = runCatching { load(command.providerId, command.deviceId) }.getOrElse { return false }
        if (current == null || current.requestId != command.requestId || current.idempotencyKey != command.idempotencyKey) return false
        return preferences.edit().remove(key(command.providerId, command.deviceId)).commit()
    }

    /** Archives an unknown command after a newer authoritative device fact makes its old CAS stale. */
    @Synchronized
    fun archiveAfterFactAdvance(command: ProviderDeviceLabelCommand, latest: ProviderDevice): Boolean {
        if (latest.deviceId != command.deviceId || latest.factVersion <= command.expectedFactVersion) return false
        val pendingKey = key(command.providerId, command.deviceId)
        val raw = preferences.getString(pendingKey, null) ?: return false
        val current = runCatching { load(command.providerId, command.deviceId) }.getOrElse { return false }
        if (current != command) return false
        if (preferences.contains(historyKey(command))) return false
        val archive = JSONObject()
            .put("originalCommand", JSONObject(raw))
            .put("outcome", "unknown_after_fact_advance")
            .put("observedFactVersion", latest.factVersion)
            .put("observedDisplayName", latest.displayName)
        return preferences.edit()
            .putString(historyKey(command), archive.toString())
            .remove(pendingKey)
            .commit()
    }

    private fun key(providerId: String, deviceId: UUID) = "${providerId}:${deviceId}"

    private fun historyKey(command: ProviderDeviceLabelCommand) =
        "history:${command.providerId}:${command.deviceId}:${command.requestId}"
}
