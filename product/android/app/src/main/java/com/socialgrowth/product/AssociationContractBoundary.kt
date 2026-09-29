package com.socialgrowth.product

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.UUID

data class InstallationAuth(
    val installationId: UUID,
    val generation: Long,
    val sessionToken: String,
    val sessionExpiresAt: String,
)

data class AssociationSession(
    val associationSessionId: UUID,
    val associationCode: String,
    val expiresAt: String,
)

data class AssociationInspection(
    val associationSessionId: UUID,
    val expiresAt: String,
    val installationId: UUID,
    val deviceLabel: String,
)

data class AssociationReceipt(
    val associationId: UUID,
    val providerId: UUID,
    val installationId: UUID,
    val deviceId: UUID,
    val confirmedAt: String,
    val state: String,
)

data class ProviderDevice(
    val factVersion: Long,
    val updatedAt: String,
    val deviceId: UUID,
    val displayName: String,
    val state: String,
    val lastObservedAt: String?,
)

object AssociationContractBoundary {
    private const val MAX_SAFE_INTEGER = 9_007_199_254_740_991L
    private val token = Regex("^[A-Za-z0-9_-]{43}$")
    private val code = Regex("^sgassoc_v1_[A-Za-z0-9_-]{43}$")
    private val timestampRegex = Regex(GeneratedFirstBatchContractSpec.TIMESTAMP_PATTERN)
    private val timestampPartsRegex = Regex("^(.*:\\d{2})(?:\\.(\\d+))?(Z|[+-]\\d{2}:\\d{2})$")
    private val activeDeviceStates = setOf(
        "associated_pending_access", "access_ready", "paused", "exit_pending", "exited",
    )

    fun parseInstallationAuth(raw: String): InstallationAuth = wrap {
        val root = JSONObject(raw).exact("installation", "session", "sessionToken", "createdNewInstallation")
        val installation = root.objectValue("installation")
            .exact("installationId", "generation", "status", "createdAt", "updatedAt")
        val session = root.objectValue("session").exact("sessionId", "createdAt", "expiresAt")
        require(installation.string("status") == "active")
        val generation = installation.long("generation")
        require(generation in 1..MAX_SAFE_INTEGER)
        val installationCreatedAt = installation.string("createdAt").also(::timestamp)
        val installationUpdatedAt = installation.string("updatedAt").also(::timestamp)
        require(compareTimestamps(installationUpdatedAt, installationCreatedAt) >= 0)
        uuid(session.string("sessionId"))
        val sessionCreatedAt = session.string("createdAt").also(::timestamp)
        val expiresAt = session.string("expiresAt").also(::timestamp)
        require(compareTimestamps(sessionCreatedAt, expiresAt) < 0)
        val sessionToken = root.string("sessionToken")
        require(token.matches(sessionToken))
        require(root.get("createdNewInstallation") is Boolean)
        InstallationAuth(
            uuid(installation.string("installationId")),
            generation,
            sessionToken,
            expiresAt,
        )
    }

    fun parseAssociationSession(raw: String): AssociationSession = wrap {
        val root = JSONObject(raw).exact(
            "associationSessionId", "associationCode", "expiresAt", "replacedPreviousSession",
        )
        val associationCode = root.string("associationCode")
        require(code.matches(associationCode))
        require(root.get("replacedPreviousSession") is Boolean)
        AssociationSession(
            uuid(root.string("associationSessionId")),
            associationCode,
            root.string("expiresAt").also(::timestamp),
        )
    }

    fun parseInspection(raw: String): AssociationInspection = wrap {
        val root = JSONObject(raw).exact("associationSessionId", "expiresAt", "installation")
        val installation = root.objectValue("installation").exact("installationId", "deviceLabel")
        val label = installation.string("deviceLabel")
        require(label.codePointCount(0, label.length) in 1..100)
        AssociationInspection(
            uuid(root.string("associationSessionId")),
            root.string("expiresAt").also(::timestamp),
            uuid(installation.string("installationId")),
            label,
        )
    }

    fun parseReceipt(raw: String): AssociationReceipt = wrap {
        val root = JSONObject(raw).exact(
            "associationId", "providerId", "installationId", "deviceId", "confirmedAt", "state",
        )
        require(root.string("state") == "associated_pending_access")
        AssociationReceipt(
            uuid(root.string("associationId")),
            uuid(root.string("providerId")),
            uuid(root.string("installationId")),
            uuid(root.string("deviceId")),
            root.string("confirmedAt").also(::timestamp),
            root.string("state"),
        )
    }

    fun parseResult(raw: String): AssociationReceipt? = wrap {
        val root = JSONObject(raw)
        when (root.string("status")) {
            "pending" -> {
                root.exact("status", "associationSessionId", "installationId", "expiresAt")
                uuid(root.string("associationSessionId"))
                uuid(root.string("installationId"))
                timestamp(root.string("expiresAt"))
                null
            }
            "associated" -> {
                root.exact("status", "result")
                parseReceipt(root.objectValue("result").toString())
            }
            else -> error("unknown association result")
        }
    }

    fun parseDevices(raw: String): List<ProviderDevice> = wrap {
        val root = JSONObject(raw).exact("devices")
        val devices = root.get("devices")
        require(devices is JSONArray)
        (0 until devices.length()).map { index ->
            val value = devices.get(index)
            require(value is JSONObject)
            value.exact("factVersion", "updatedAt", "deviceId", "displayName", "state", "lastObservedAt")
            val state = value.string("state")
            require(state in activeDeviceStates)
            val displayName = value.string("displayName")
            require(displayName.isNotEmpty())
            ProviderDevice(
                value.long("factVersion").also { require(it in 0..MAX_SAFE_INTEGER) },
                value.string("updatedAt").also(::timestamp),
                uuid(value.string("deviceId")),
                displayName,
                state,
                if (value.isNull("lastObservedAt")) null else value.string("lastObservedAt").also(::timestamp),
            )
        }
    }

    private fun JSONObject.exact(vararg keys: String): JSONObject {
        val actual = buildSet {
            val iterator = this@exact.keys()
            while (iterator.hasNext()) add(iterator.next())
        }
        require(actual == keys.toSet()) { "unexpected response fields" }
        return this
    }

    private fun JSONObject.objectValue(name: String): JSONObject =
        get(name).let { value -> require(value is JSONObject); value }

    private fun JSONObject.string(name: String): String =
        get(name).let { value -> require(value is String && value.isNotEmpty()); value }

    private fun JSONObject.long(name: String): Long =
        get(name).let { value ->
            require(value is Number)
            val decimal = BigDecimal(value.toString())
            require(decimal.stripTrailingZeros().scale() <= 0)
            decimal.longValueExact()
        }

    private fun uuid(value: String) = UUID.fromString(value)
    private fun timestamp(value: String) { require(timestampRegex.matches(value)) }

    private fun compareTimestamps(left: String, right: String): Int {
        fun parts(value: String): Pair<Long, String> {
            val match = requireNotNull(timestampPartsRegex.matchEntire(value))
            val localSeconds = LocalDateTime.parse(match.groupValues[1]).toEpochSecond(ZoneOffset.UTC)
            val zone = match.groupValues[3]
            val offsetMinutes = if (zone == "Z") {
                0
            } else {
                val sign = if (zone[0] == '+') 1 else -1
                sign * (zone.substring(1, 3).toInt() * 60 + zone.substring(4, 6).toInt())
            }
            return localSeconds - offsetMinutes * 60L to match.groupValues[2]
        }
        val leftParts = parts(left)
        val rightParts = parts(right)
        if (leftParts.first != rightParts.first) return leftParts.first.compareTo(rightParts.first)
        val width = maxOf(leftParts.second.length, rightParts.second.length)
        return leftParts.second.padEnd(width, '0').compareTo(rightParts.second.padEnd(width, '0'))
    }

    private inline fun <T> wrap(block: () -> T): T = try {
        block()
    } catch (error: ContractBoundaryException) {
        throw error
    } catch (error: Exception) {
        throw ContractBoundaryException("Invalid association response", error)
    }
}
