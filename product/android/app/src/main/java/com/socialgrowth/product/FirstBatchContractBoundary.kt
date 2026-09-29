package com.socialgrowth.product

import org.json.JSONObject
import java.time.Instant
import java.util.UUID

data class AssociationQrPayload(
    val contractVersion: String,
    val associationCode: String,
)

data class InstallationSelfView(
    val factVersion: Long,
    val updatedAt: Instant,
    val installationId: UUID,
    val state: String,
    val deviceId: UUID?,
)

data class ProductError(
    val contractVersion: String,
    val requestId: String,
    val code: String,
    val message: String,
    val retryable: Boolean,
    val field: String?,
)

class ContractBoundaryException(message: String, cause: Throwable? = null) :
    IllegalArgumentException(message, cause)

object FirstBatchContractBoundary {
    private val associationCodeRegex = Regex(GeneratedFirstBatchContractSpec.ASSOCIATION_CODE_PATTERN)
    private val timestampRegex = Regex(GeneratedFirstBatchContractSpec.TIMESTAMP_PATTERN)
    private val uuidRegex = Regex(GeneratedFirstBatchContractSpec.UUID_PATTERN)

    fun parseAssociationQrPayload(raw: String): AssociationQrPayload = wrap {
        val json = JSONObject(raw)
        requireExactKeys(json, GeneratedFirstBatchContractSpec.ASSOCIATION_QR_KEYS)
        val version = requireString(json, "contractVersion")
        require(version == GeneratedFirstBatchContractSpec.CONTRACT_VERSION) {
            "unsupported contractVersion"
        }
        val code = requireString(json, "associationCode")
        require(associationCodeRegex.matches(code)) { "invalid associationCode" }
        AssociationQrPayload(version, code)
    }

    fun parseInstallationSelfView(raw: String): InstallationSelfView = wrap {
        val json = JSONObject(raw)
        requireExactKeys(json, GeneratedFirstBatchContractSpec.INSTALLATION_SELF_KEYS)
        val factVersion = requireLong(json, "factVersion")
        require(factVersion in 0..GeneratedFirstBatchContractSpec.FACT_VERSION_MAX) {
            "factVersion is outside the supported range"
        }
        val updatedAt = requireTimestamp(json, "updatedAt")
        val installationId = requireUuid(json, "installationId")
        val state = requireString(json, "state")
        require(state in GeneratedFirstBatchContractSpec.INSTALLATION_STATES) { "unknown state" }
        val deviceId = if (json.isNull("deviceId")) null else requireUuid(json, "deviceId")
        require((state == "unassociated") == (deviceId == null)) {
            "state and deviceId contradict each other"
        }
        InstallationSelfView(factVersion, updatedAt, installationId, state, deviceId)
    }

    fun parseProductError(raw: String): ProductError = wrap {
        val json = JSONObject(raw)
        requireExactKeys(json, GeneratedFirstBatchContractSpec.ERROR_RESPONSE_KEYS)
        val version = requireString(json, "contractVersion")
        require(version == GeneratedFirstBatchContractSpec.CONTRACT_VERSION) {
            "unsupported contractVersion"
        }
        val requestId = requireString(json, "requestId")
        require(requestId.length in 8..128) { "invalid requestId" }
        val error = json.get("error")
        require(error is JSONObject) { "error must be an object" }
        val errorKeys = GeneratedFirstBatchContractSpec.ERROR_DETAIL_KEYS + setOf("field")
        requireExactKeys(error, errorKeys, optional = setOf("field"))
        val code = requireString(error, "code")
        require(code in GeneratedFirstBatchContractSpec.ERROR_CODES) { "unknown error code" }
        val message = requireString(error, "message")
        require(message.isNotEmpty()) { "empty error message" }
        val field = if (error.has("field")) requireString(error, "field") else null
        require(field == null || field.isNotEmpty()) { "empty error field" }
        ProductError(version, requestId, code, message, requireBoolean(error, "retryable"), field)
    }

    private fun requireExactKeys(
        json: JSONObject,
        allowed: Set<String>,
        optional: Set<String> = emptySet(),
    ) {
        val actual = buildSet { json.keys().forEachRemaining(::add) }
        require(actual.all { it in allowed }) { "unknown fields: ${actual - allowed}" }
        require(actual.containsAll(allowed - optional)) { "missing fields: ${(allowed - optional) - actual}" }
    }

    private fun requireString(json: JSONObject, key: String): String {
        val value = json.get(key)
        require(value is String) { "$key must be a string" }
        return value
    }

    private fun requireBoolean(json: JSONObject, key: String): Boolean {
        val value = json.get(key)
        require(value is Boolean) { "$key must be a boolean" }
        return value
    }

    private fun requireLong(json: JSONObject, key: String): Long {
        val value = json.get(key)
        require(value is Int || value is Long) { "$key must be an integer" }
        return (value as Number).toLong()
    }

    private fun requireUuid(json: JSONObject, key: String): UUID {
        val value = requireString(json, key)
        require(uuidRegex.matches(value)) { "$key must be a UUID" }
        return UUID.fromString(value)
    }

    private fun requireTimestamp(json: JSONObject, key: String): Instant {
        val value = requireString(json, key)
        require(timestampRegex.matches(value)) { "$key must be an RFC 3339 timestamp" }
        return Instant.parse(value)
    }

    private inline fun <T> wrap(block: () -> T): T = try {
        block()
    } catch (error: ContractBoundaryException) {
        throw error
    } catch (error: Exception) {
        throw ContractBoundaryException(error.message ?: "contract validation failed", error)
    }
}
