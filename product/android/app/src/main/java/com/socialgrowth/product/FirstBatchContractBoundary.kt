package com.socialgrowth.product

import org.json.JSONObject
import java.math.BigDecimal
import java.util.UUID

data class AssociationQrPayload(
    val contractVersion: String,
    val associationCode: String,
)

data class InstallationSelfView(
    val factVersion: Long,
    val updatedAt: String,
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
        requireExactKeys(
            json,
            GeneratedFirstBatchContractSpec.ASSOCIATION_QR_KEYS,
            GeneratedFirstBatchContractSpec.ASSOCIATION_QR_REQUIRED_KEYS,
        )
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
        requireExactKeys(
            json,
            GeneratedFirstBatchContractSpec.INSTALLATION_SELF_KEYS,
            GeneratedFirstBatchContractSpec.INSTALLATION_SELF_REQUIRED_KEYS,
        )
        val factVersion = requireLong(json, "factVersion")
        require(
            factVersion in
                GeneratedFirstBatchContractSpec.FACT_VERSION_MIN..
                GeneratedFirstBatchContractSpec.FACT_VERSION_MAX,
        ) {
            "factVersion is outside the supported range"
        }
        val updatedAt = requireTimestamp(json, "updatedAt")
        val installationId = requireUuid(json, "installationId")
        val state = requireString(json, "state")
        require(
            state in GeneratedFirstBatchContractSpec.NULL_DEVICE_STATES ||
                state in GeneratedFirstBatchContractSpec.IDENTIFIED_DEVICE_STATES,
        ) { "unknown state" }
        val deviceId = if (json.isNull("deviceId")) null else requireUuid(json, "deviceId")
        require(
            (state in GeneratedFirstBatchContractSpec.NULL_DEVICE_STATES) == (deviceId == null),
        ) {
            "state and deviceId contradict each other"
        }
        InstallationSelfView(factVersion, updatedAt, installationId, state, deviceId)
    }

    fun parseProductError(raw: String): ProductError = wrap {
        val json = JSONObject(raw)
        requireExactKeys(
            json,
            GeneratedFirstBatchContractSpec.ERROR_RESPONSE_KEYS,
            GeneratedFirstBatchContractSpec.ERROR_RESPONSE_REQUIRED_KEYS,
        )
        val version = requireString(json, "contractVersion")
        require(version == GeneratedFirstBatchContractSpec.CONTRACT_VERSION) {
            "unsupported contractVersion"
        }
        val requestId = requireString(json, "requestId")
        require(
            requestId.length in
                GeneratedFirstBatchContractSpec.REQUEST_ID_MIN_LENGTH..
                GeneratedFirstBatchContractSpec.REQUEST_ID_MAX_LENGTH,
        ) { "invalid requestId" }
        val error = json.get("error")
        require(error is JSONObject) { "error must be an object" }
        requireExactKeys(
            error,
            GeneratedFirstBatchContractSpec.ERROR_DETAIL_KEYS,
            GeneratedFirstBatchContractSpec.ERROR_DETAIL_REQUIRED_KEYS,
        )
        val code = requireString(error, "code")
        require(code in GeneratedFirstBatchContractSpec.ERROR_CODES) { "unknown error code" }
        val message = requireString(error, "message")
        require(message.length >= GeneratedFirstBatchContractSpec.ERROR_MESSAGE_MIN_LENGTH) {
            "empty error message"
        }
        val field = if (error.has("field")) requireString(error, "field") else null
        require(
            field == null || field.length >= GeneratedFirstBatchContractSpec.ERROR_FIELD_MIN_LENGTH,
        ) { "empty error field" }
        ProductError(version, requestId, code, message, requireBoolean(error, "retryable"), field)
    }

    private fun requireExactKeys(
        json: JSONObject,
        allowed: Set<String>,
        required: Set<String>,
    ) {
        val actual = buildSet { json.keys().forEachRemaining(::add) }
        require(actual.all { it in allowed }) { "unknown fields: ${actual - allowed}" }
        require(actual.containsAll(required)) { "missing fields: ${required - actual}" }
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
        require(value is Number) { "$key must be a number" }
        val decimal = BigDecimal(value.toString())
        require(decimal.stripTrailingZeros().scale() <= 0) { "$key must be an integer" }
        return decimal.longValueExact()
    }

    private fun requireUuid(json: JSONObject, key: String): UUID {
        val value = requireString(json, key)
        require(uuidRegex.matches(value)) { "$key must be a UUID" }
        return UUID.fromString(value)
    }

    private fun requireTimestamp(json: JSONObject, key: String): String {
        val value = requireString(json, key)
        require(timestampRegex.matches(value)) { "$key must be an RFC 3339 timestamp" }
        return value
    }

    private inline fun <T> wrap(block: () -> T): T = try {
        block()
    } catch (error: ContractBoundaryException) {
        throw error
    } catch (error: Exception) {
        throw ContractBoundaryException(error.message ?: "contract validation failed", error)
    }
}
