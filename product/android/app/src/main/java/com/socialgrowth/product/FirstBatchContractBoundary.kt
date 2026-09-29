package com.socialgrowth.product

import org.json.JSONObject
import java.math.BigDecimal
import java.time.OffsetDateTime
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

data class PhoneVerificationChallenge(
    val challengeId: UUID,
    val purpose: String,
    val phoneHint: String,
    val deliveryState: String,
    val expiresAt: String,
    val resendAvailableAt: String,
)

data class PhoneVerificationProof(
    val phoneVerificationId: UUID,
    val purpose: String,
    val phoneHint: String,
    val verifiedAt: String,
    val expiresAt: String,
)

data class ProviderSelfView(
    val providerId: UUID,
    val displayName: String,
    val phoneHint: String,
    val status: String,
    val createdAt: String,
    val updatedAt: String,
)

data class SessionSummary(
    val sessionId: UUID,
    val createdAt: String,
    val expiresAt: String,
)

data class ProviderAuthResult(
    val provider: ProviderSelfView,
    val session: SessionSummary,
    val sessionToken: String,
)

class ContractBoundaryException(message: String, cause: Throwable? = null) :
    IllegalArgumentException(message, cause)

object FirstBatchContractBoundary {
    private val associationCodeRegex = Regex(GeneratedFirstBatchContractSpec.ASSOCIATION_CODE_PATTERN)
    private val timestampRegex = Regex(GeneratedFirstBatchContractSpec.TIMESTAMP_PATTERN)
    private val uuidRegex = Regex(GeneratedFirstBatchContractSpec.UUID_PATTERN)
    private val phoneHintRegex = Regex(GeneratedFirstBatchContractSpec.PHONE_HINT_PATTERN)
    private val sessionTokenRegex = Regex(GeneratedFirstBatchContractSpec.SESSION_TOKEN_PATTERN)
    private val timestampPartsRegex = Regex("^(.*:\\d{2})(?:\\.(\\d+))?(Z|[+-]\\d{2}:\\d{2})$")

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

    fun parsePhoneVerificationChallenge(raw: String): PhoneVerificationChallenge = wrap {
        val json = JSONObject(raw)
        requireExactKeys(
            json,
            GeneratedFirstBatchContractSpec.PHONE_CHALLENGE_KEYS,
            GeneratedFirstBatchContractSpec.PHONE_CHALLENGE_REQUIRED_KEYS,
        )
        val expiresAt = requireTimestamp(json, "expiresAt")
        val resendAvailableAt = requireTimestamp(json, "resendAvailableAt")
        require(compareTimestamps(resendAvailableAt, expiresAt) <= 0) {
            "resend availability is after challenge expiry"
        }
        val purpose = requirePurpose(json)
        val deliveryState = requireString(json, "deliveryState")
        require(deliveryState == GeneratedFirstBatchContractSpec.PHONE_CHALLENGE_DELIVERY_STATE) {
            "unknown deliveryState"
        }
        PhoneVerificationChallenge(
            requireUuid(json, "challengeId"),
            purpose,
            requirePhoneHint(json),
            deliveryState,
            expiresAt,
            resendAvailableAt,
        )
    }

    fun parsePhoneVerificationProof(raw: String): PhoneVerificationProof = wrap {
        val json = JSONObject(raw)
        requireExactKeys(
            json,
            GeneratedFirstBatchContractSpec.PHONE_PROOF_KEYS,
            GeneratedFirstBatchContractSpec.PHONE_PROOF_REQUIRED_KEYS,
        )
        val verifiedAt = requireTimestamp(json, "verifiedAt")
        val expiresAt = requireTimestamp(json, "expiresAt")
        require(compareTimestamps(verifiedAt, expiresAt) < 0) {
            "verification proof is already expired"
        }
        PhoneVerificationProof(
            requireUuid(json, "phoneVerificationId"),
            requirePurpose(json),
            requirePhoneHint(json),
            verifiedAt,
            expiresAt,
        )
    }

    fun parseProviderSelfView(raw: String): ProviderSelfView = wrap {
        parseProviderSelfObject(JSONObject(raw))
    }

    fun parseProviderAuthResponse(raw: String): ProviderAuthResult = wrap {
        val json = JSONObject(raw)
        requireExactKeys(
            json,
            GeneratedFirstBatchContractSpec.PROVIDER_AUTH_KEYS,
            GeneratedFirstBatchContractSpec.PROVIDER_AUTH_REQUIRED_KEYS,
        )
        val providerJson = json.get("provider")
        require(providerJson is JSONObject) { "provider must be an object" }
        val sessionJson = json.get("session")
        require(sessionJson is JSONObject) { "session must be an object" }
        val sessionToken = requireString(json, "sessionToken")
        require(sessionTokenRegex.matches(sessionToken)) { "invalid sessionToken" }
        ProviderAuthResult(
            parseProviderSelfObject(providerJson),
            parseSessionSummary(sessionJson),
            sessionToken,
        )
    }

    private fun parseProviderSelfObject(json: JSONObject): ProviderSelfView {
        requireExactKeys(
            json,
            GeneratedFirstBatchContractSpec.PROVIDER_SELF_KEYS,
            GeneratedFirstBatchContractSpec.PROVIDER_SELF_REQUIRED_KEYS,
        )
        val displayName = requireString(json, "displayName")
        require(displayName.length in 1..100) { "invalid displayName" }
        val status = requireString(json, "status")
        require(status in GeneratedFirstBatchContractSpec.PROVIDER_STATUSES) { "unknown provider status" }
        val createdAt = requireTimestamp(json, "createdAt")
        val updatedAt = requireTimestamp(json, "updatedAt")
        require(compareTimestamps(updatedAt, createdAt) >= 0) { "provider update predates creation" }
        return ProviderSelfView(
            requireUuid(json, "providerId"),
            displayName,
            requirePhoneHint(json),
            status,
            createdAt,
            updatedAt,
        )
    }

    private fun parseSessionSummary(json: JSONObject): SessionSummary {
        requireExactKeys(
            json,
            GeneratedFirstBatchContractSpec.SESSION_KEYS,
            GeneratedFirstBatchContractSpec.SESSION_REQUIRED_KEYS,
        )
        val createdAt = requireTimestamp(json, "createdAt")
        val expiresAt = requireTimestamp(json, "expiresAt")
        require(compareTimestamps(createdAt, expiresAt) < 0) { "session is already expired" }
        return SessionSummary(requireUuid(json, "sessionId"), createdAt, expiresAt)
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

    private fun requirePurpose(json: JSONObject): String {
        val purpose = requireString(json, "purpose")
        require(purpose in GeneratedFirstBatchContractSpec.PHONE_VERIFICATION_PURPOSES) {
            "unknown verification purpose"
        }
        return purpose
    }

    private fun requirePhoneHint(json: JSONObject): String {
        val phoneHint = requireString(json, "phoneHint")
        require(phoneHintRegex.matches(phoneHint)) { "invalid masked phone hint" }
        return phoneHint
    }

    private fun compareTimestamps(left: String, right: String): Int {
        fun parts(value: String): Pair<Long, String> {
            val match = requireNotNull(timestampPartsRegex.matchEntire(value)) {
                "timestamp was not structurally validated"
            }
            val wholeSeconds = OffsetDateTime.parse(match.groupValues[1] + match.groupValues[3])
                .toEpochSecond()
            return wholeSeconds to match.groupValues[2]
        }
        val leftParts = parts(left)
        val rightParts = parts(right)
        if (leftParts.first != rightParts.first) {
            return leftParts.first.compareTo(rightParts.first)
        }
        val width = maxOf(leftParts.second.length, rightParts.second.length)
        return leftParts.second.padEnd(width, '0').compareTo(rightParts.second.padEnd(width, '0'))
    }

    private inline fun <T> wrap(block: () -> T): T = try {
        block()
    } catch (error: ContractBoundaryException) {
        throw error
    } catch (error: Exception) {
        throw ContractBoundaryException(error.message ?: "contract validation failed", error)
    }
}
