package com.socialgrowth.product

import android.util.Base64
import org.json.JSONObject
import java.net.URI
import java.net.URL
import java.nio.charset.StandardCharsets
import java.security.KeyFactory
import java.security.PublicKey
import java.security.spec.X509EncodedKeySpec
import javax.net.ssl.HttpsURLConnection

/** Strict HTTPS-only keyset and online one-use consume. No redirects or key persistence. */
internal class MediaCredentialInputAuthorizationClient(private val baseUrl: String) {
    fun ensureExistingKeyEnrolled(
        installationToken: String,
        installationId: java.util.UUID,
        installationGeneration: Long,
        signer: EnrollmentKeySigner,
    ) {
        require(installationGeneration > 0)
        val publicKey = signer.existingMediaInputPublicKey()
        val spki = publicKey.encoded
        try {
            val spkiBase64 = Base64.encodeToString(spki, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            val common = JSONObject()
                .put("contractVersion", CONTRACT_VERSION)
                .put("installationId", installationId.toString())
                .put("installationGeneration", installationGeneration)
                .put("publicKeySpki", spkiBase64)
            val challengeResponse = request(
                path = ENROLLMENT_CHALLENGE_PATH,
                method = "POST",
                bearer = installationToken,
                body = common.toString().toByteArray(StandardCharsets.UTF_8),
            )
            val challengeJson = JSONObject(challengeResponse)
            require(challengeJson.keys().asSequence().toSet() == setOf("contractVersion", "challengeId", "challenge"))
            require(challengeJson.getString("contractVersion") == CONTRACT_VERSION)
            val challengeId = java.util.UUID.fromString(challengeJson.getString("challengeId"))
            val challenge = decodeCanonicalBase64Url(challengeJson.getString("challenge"), 32)
            val proofInput = enrollmentProofInput(installationId, installationGeneration, challengeId, challenge, spki)
            val proof = try { signer.signExistingMediaInputProof(proofInput) } finally { proofInput.fill(0) }
            challenge.fill(0)
            val completeBody = JSONObject()
                .put("contractVersion", CONTRACT_VERSION)
                .put("installationId", installationId.toString())
                .put("installationGeneration", installationGeneration)
                .put("publicKeySpki", spkiBase64)
                .put("challengeId", challengeId.toString())
                .put("proof", Base64.encodeToString(proof, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING))
            proof.fill(0)
            val completeResponse = JSONObject(request(
                path = ENROLLMENT_COMPLETE_PATH,
                method = "POST",
                bearer = installationToken,
                body = completeBody.toString().toByteArray(StandardCharsets.UTF_8),
            ))
            require(completeResponse.keys().asSequence().toSet() == setOf("decision", "keyId"))
            require(completeResponse.getString("decision") in setOf("enrolled", "already_enrolled"))
            require(completeResponse.getString("keyId") == sha256Hex(spki))
        } finally {
            spki.fill(0)
        }
    }

    fun loadServerKeys(installationToken: String, nowMillis: Long): Map<String, PublicKey> {
        val response = request(
            path = KEYSET_PATH,
            method = "GET",
            bearer = installationToken,
            body = null,
        )
        val json = JSONObject(response)
        require(json.keys().asSequence().toSet() == setOf("contractVersion", "keys"))
        require(json.getString("contractVersion") == CONTRACT_VERSION)
        val keys = json.getJSONArray("keys")
        require(keys.length() in 1..MAX_KEYS)
        val result = LinkedHashMap<String, PublicKey>()
        for (index in 0 until keys.length()) {
            val item = keys.getJSONObject(index)
            require(item.keys().asSequence().toSet() == setOf(
                "keyId", "algorithm", "spkiDerBase64Url", "notBefore", "notAfter",
            ))
            val keyId = item.getString("keyId")
            require(KEY_ID_PATTERN.matches(keyId) && keyId !in result)
            require(item.getString("algorithm") == KEY_ALGORITHM)
            val notBefore = item.getLong("notBefore")
            val notAfter = item.getLong("notAfter")
            require(notBefore > 0 && notAfter > notBefore && nowMillis in notBefore until notAfter)
            val encoded = item.getString("spkiDerBase64Url")
            require(encoded.length in MIN_KEY_BASE64_LENGTH..MAX_KEY_BASE64_LENGTH)
            val spki = Base64.decode(encoded, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            try {
                val publicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(spki))
                P256SignatureEncoding.requireP256(publicKey)
                require(publicKey.encoded.contentEquals(spki))
                val canonicalBase64 = Base64.encodeToString(
                    spki,
                    Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
                )
                require(canonicalBase64 == encoded)
                require(sha256Hex(spki) == keyId)
                result[keyId] = publicKey
            } finally {
                spki.fill(0)
            }
        }
        return result
    }

    fun consumeOnce(installationToken: String, actionId: String, envelopeDigestBase64Url: String): Boolean {
        val body = JSONObject()
            .put("contractVersion", CONTRACT_VERSION)
            .put("requestId", actionId)
            .put("envelopeSha256", envelopeDigestBase64Url)
        val response = request(
            path = CONSUME_PATH,
            method = "POST",
            bearer = installationToken,
            body = body.toString().toByteArray(StandardCharsets.UTF_8),
        )
        val json = JSONObject(response)
        require(json.keys().asSequence().toSet() == setOf("decision", "requestId"))
        return json.getString("decision") == PROCEED_ONCE && json.getString("requestId") == actionId
    }

    fun recordStatus(
        installationToken: String,
        requestId: String,
        actionId: String,
        rawSignedStatusFrame: ByteArray,
        expectedPhase: Int,
    ) {
        require(requestId == actionId && rawSignedStatusFrame.isNotEmpty())
        val body = JSONObject()
            .put("contractVersion", CONTRACT_VERSION)
            .put("requestId", requestId)
            .put("actionId", actionId)
            .put("statusFrameBase64Url", Base64.encodeToString(
                rawSignedStatusFrame,
                Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
            ))
        val response = JSONObject(request(
            path = STATUS_PATH,
            method = "POST",
            bearer = installationToken,
            body = body.toString().toByteArray(StandardCharsets.UTF_8),
        ))
        require(response.keys().asSequence().toSet() == setOf("decision", "requestId", "actionId", "phase"))
        require(response.getString("decision") == "accepted" &&
            response.getString("requestId") == requestId &&
            response.getString("actionId") == actionId && response.getInt("phase") == expectedPhase)
    }

    private fun enrollmentProofInput(
        installationId: java.util.UUID,
        generation: Long,
        challengeId: java.util.UUID,
        challenge: ByteArray,
        spki: ByteArray,
    ): ByteArray {
        require(generation > 0 && challenge.size == 32)
        val digest = java.security.MessageDigest.getInstance("SHA-256").digest(spki)
        return try {
            java.io.ByteArrayOutputStream().use { bytes ->
                java.io.DataOutputStream(bytes).use { data ->
                    data.write(ENROLLMENT_PROOF_DOMAIN)
                    data.writeLong(installationId.mostSignificantBits)
                    data.writeLong(installationId.leastSignificantBits)
                    data.writeLong(generation)
                    data.writeLong(challengeId.mostSignificantBits)
                    data.writeLong(challengeId.leastSignificantBits)
                    data.write(challenge)
                    data.write(digest)
                }
                bytes.toByteArray()
            }
        } finally {
            digest.fill(0)
        }
    }

    private fun decodeCanonicalBase64Url(encoded: String, expectedBytes: Int): ByteArray {
        require(encoded.matches(Regex("^[A-Za-z0-9_-]+$")))
        val decoded = Base64.decode(encoded, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        require(decoded.size == expectedBytes &&
            Base64.encodeToString(decoded, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING) == encoded)
        return decoded
    }

    private fun request(path: String, method: String, bearer: String, body: ByteArray?): String {
        require(bearer.matches(Regex("^[A-Za-z0-9_-]{43}$")))
        val origin = trustedOrigin() ?: throw IllegalStateException("trusted HTTPS endpoint unavailable")
        val connection = URL(origin + path).openConnection() as HttpsURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.requestMethod = method
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $bearer")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body) }
            }
            require(connection.responseCode == 200)
            val stream = connection.inputStream
            val bytes = stream.use { input ->
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(2048)
                var total = 0
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    total += read
                    require(total <= MAX_RESPONSE_BYTES)
                    output.write(buffer, 0, read)
                }
                buffer.fill(0)
                output.toByteArray()
            }
            try {
                return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                    .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                    .decode(java.nio.ByteBuffer.wrap(bytes)).toString()
            } finally {
                bytes.fill(0)
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun trustedOrigin(): String? {
        return try {
            val endpoint = URI(baseUrl)
            if (!endpoint.scheme.equals("https", ignoreCase = true) || endpoint.host.isNullOrBlank() ||
                endpoint.userInfo != null || endpoint.query != null || endpoint.fragment != null ||
                endpoint.rawPath !in setOf("", "/") || endpoint.port !in -1..65535
            ) {
                null
            } else {
                "https://${endpoint.host.lowercase()}" + if (endpoint.port == -1) "" else ":${endpoint.port}"
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun sha256Hex(bytes: ByteArray): String = java.security.MessageDigest.getInstance("SHA-256")
        .digest(bytes)
        .joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }

    companion object {
        const val CONTRACT_VERSION = "media-credential-input-v1"
        private const val KEYSET_PATH = "/api/installation/media-credential-input/grant-keys"
        private const val CONSUME_PATH = "/api/installation/media-credential-input/actions/consume"
        private const val ENROLLMENT_CHALLENGE_PATH = "/api/installation/media-credential-input/enrollment/challenge"
        private const val ENROLLMENT_COMPLETE_PATH = "/api/installation/media-credential-input/enrollment/complete"
        private const val STATUS_PATH = "/api/installation/media-credential-input/actions/status"
        private val ENROLLMENT_PROOF_DOMAIN = "SGMI-ENROLL-PROOF-v1\u0000".toByteArray(StandardCharsets.US_ASCII)
        private const val KEY_ALGORITHM = "ecdsa-p256-sha256"
        private const val PROCEED_ONCE = "proceed_once"
        private const val MAX_KEYS = 8
        private const val TIMEOUT_MS = 8_000
        private const val MAX_RESPONSE_BYTES = 32 * 1024
        private const val MIN_KEY_BASE64_LENGTH = 100
        private const val MAX_KEY_BASE64_LENGTH = 1024
        private val KEY_ID_PATTERN = Regex("^[a-f0-9]{64}$")
    }
}
