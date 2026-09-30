package com.socialgrowth.product

import org.json.JSONObject
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.UUID

internal data class AdmissionNode(val nodeId: String, val nodeKey: String, val networkRevision: Long)
internal data class EnrollmentSigningContext(
    val enrollmentId: UUID, val deviceId: UUID, val installationId: UUID,
    val installationGeneration: String, val enrollmentGeneration: String,
)
internal data class EnrollmentChallenge(
    val protocolVersion: String, val purpose: String, val challengeId: UUID,
    val context: EnrollmentSigningContext, val node: AdmissionNode, val nonce: String,
    val issuedAt: String, val expiresAt: String,
    val wireIds: List<String>,
) {
    fun signingBytes(): ByteArray = AdmissionContractBoundary.signingBytes(this)
    fun checkScope(expected: EnrollmentSigningContext, now: Instant) {
        require(context == expected) { "Challenge target changed" }
        val time = BigDecimal(now.epochSecond).add(BigDecimal(now.nano).movePointLeft(9))
        require(time >= AdmissionContractBoundary.timestamp(issuedAt) && time < AdmissionContractBoundary.timestamp(expiresAt)) {
            "Challenge outside valid window"
        }
    }
}

internal object AdmissionContractBoundary {
    private val timeParts = Regex("^(.*:\\d{2})(?:\\.(\\d+))?(Z|([+-])(\\d{2}):(\\d{2}))$")
    fun parse(raw: String): EnrollmentChallenge = try {
        val json = JSONObject(raw)
        exact(json, GeneratedAdmissionContractSpec.CHALLENGE_KEYS, GeneratedAdmissionContractSpec.CHALLENGE_REQUIRED_KEYS)
        val protocol = string(json, "protocolVersion")
        val purpose = string(json, "purpose")
        require(protocol == GeneratedAdmissionContractSpec.PROTOCOL_VERSION && purpose == GeneratedAdmissionContractSpec.PURPOSE)
        val node = json.get("node") as? JSONObject ?: error("Invalid node")
        exact(node, GeneratedAdmissionContractSpec.NODE_KEYS, GeneratedAdmissionContractSpec.NODE_REQUIRED_KEYS)
        val nodeId = string(node, "nodeId").also { require(Regex(GeneratedAdmissionContractSpec.NODE_ID_PATTERN).matches(it)) }
        val nodeKey = string(node, "nodeKey").also {
            require(it.codePointCount(0, it.length) in GeneratedAdmissionContractSpec.NODE_KEY_MIN..GeneratedAdmissionContractSpec.NODE_KEY_MAX)
        }
        val revisionValue = node.get("networkRevision")
        require(revisionValue is Number)
        val revision = BigDecimal(revisionValue.toString()).longValueExact()
        require(revision in GeneratedAdmissionContractSpec.NETWORK_REVISION_MIN..GeneratedAdmissionContractSpec.NETWORK_REVISION_MAX)
        val nonce = string(json, "nonce").also { require(Regex(GeneratedAdmissionContractSpec.NONCE_PATTERN).matches(it)) }
        val issued = string(json, "issuedAt")
        val expires = string(json, "expiresAt")
        require(timestamp(issued) < timestamp(expires))
        EnrollmentChallenge(protocol, purpose, uuid(json, "challengeId"),
            EnrollmentSigningContext(uuid(json, "enrollmentId"), uuid(json, "deviceId"), uuid(json, "installationId"),
                generation(json, "installationGeneration"), generation(json, "enrollmentGeneration")),
            AdmissionNode(nodeId, nodeKey, revision), nonce, issued, expires,
            listOf("challengeId", "enrollmentId", "deviceId", "installationId").map { string(json, it) })
    } catch (_: Exception) {
        // Raw JSON and parse causes may contain challenge/identity material.
        throw ContractBoundaryException("Invalid network admission challenge")
    }

    private fun exact(json: JSONObject, allowed: Set<String>, required: Set<String>) {
        val actual = json.keys().asSequence().toSet()
        require(actual.all { it in allowed } && actual.containsAll(required))
    }
    private fun string(json: JSONObject, field: String): String = json.get(field) as? String ?: error("Invalid string")
    private fun uuid(json: JSONObject, field: String): UUID = string(json, field).let {
        require(Regex(GeneratedAdmissionContractSpec.UUID_PATTERN).matches(it)); UUID.fromString(it)
    }
    private fun generation(json: JSONObject, field: String): String = string(json, field).also {
        require(Regex(GeneratedAdmissionContractSpec.GENERATION_PATTERN).matches(it))
    }

    // Preserve the source spelling for signatures, but compare arbitrary decimal
    // precision and allowed offsets losslessly without millisecond coercion.
    internal fun timestamp(value: String): BigDecimal {
        require(Regex(GeneratedAdmissionContractSpec.TIMESTAMP_PATTERN).matches(value))
        val parts = timeParts.matchEntire(value) ?: error("Invalid timestamp")
        val seconds = LocalDateTime.parse(parts.groupValues[1]).toEpochSecond(ZoneOffset.UTC)
        val offset = if (parts.groupValues[3] == "Z") 0 else {
            val sign = if (parts.groupValues[4] == "+") 1 else -1
            sign * (parts.groupValues[5].toInt() * 3600 + parts.groupValues[6].toInt() * 60)
        }
        val fraction = parts.groupValues[2].takeIf { it.isNotEmpty() }?.let { BigDecimal("0.$it") } ?: BigDecimal.ZERO
        return BigDecimal(seconds - offset).add(fraction)
    }

    internal fun signingBytes(c: EnrollmentChallenge): ByteArray {
        val fields = listOf(c.protocolVersion, c.purpose) + c.wireIds + listOf(c.context.installationGeneration,
            c.context.enrollmentGeneration, c.node.nodeId, c.node.nodeKey)
        val tail = listOf(c.nonce, c.issuedAt, c.expiresAt)
        // org.json may escape slashes differently from JSON.stringify. Use its
        // exact well-formed string rules, fixed tuple order and UTF-8 instead.
        return ("[" + fields.joinToString(",", transform = ::quote) + ",${c.node.networkRevision}," +
            tail.joinToString(",", transform = ::quote) + "]").toByteArray(Charsets.UTF_8)
    }

    internal fun quote(value: String): String = buildString {
        append('"')
        var index = 0
        while (index < value.length) {
            val char = value[index]
            when (char) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\b' -> append("\\b")
                '\t' -> append("\\t")
                '\n' -> append("\\n")
                '\u000c' -> append("\\f")
                '\r' -> append("\\r")
                else -> when {
                    char.code < 32 -> append("\\u" + char.code.toString(16).padStart(4, '0'))
                    char.isHighSurrogate() -> if (index + 1 < value.length && value[index + 1].isLowSurrogate()) {
                        append(char); append(value[++index])
                    } else append("\\u" + char.code.toString(16).padStart(4, '0'))
                    char.isLowSurrogate() -> append("\\u" + char.code.toString(16).padStart(4, '0'))
                    else -> append(char)
                }
            }
            index++
        }
        append('"')
    }
}
