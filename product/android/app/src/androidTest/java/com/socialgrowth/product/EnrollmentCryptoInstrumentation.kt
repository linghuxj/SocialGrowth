package com.socialgrowth.product

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import android.util.Base64
import org.json.JSONObject
import java.security.KeyFactory
import java.security.KeyStore
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.time.Instant
import java.util.UUID

// Supplemental native crypto checks, not UI/business acceptance. No backend,
// network admission, media app or previously enrolled installation is touched.
class EnrollmentCryptoInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }

    override fun onStart() {
        val installationId = UUID.randomUUID()
        val missingId = UUID.randomUUID()
        var checks = 0
        val result = Bundle()
        try {
            val now = Instant.now()
            val expected = EnrollmentSigningContext(UUID.randomUUID(), UUID.randomUUID(), installationId, "9007199254740993", "1")
            fun challenge(context: EnrollmentSigningContext = expected): String = JSONObject()
                .put("protocolVersion", GeneratedAdmissionContractSpec.PROTOCOL_VERSION)
                .put("purpose", GeneratedAdmissionContractSpec.PURPOSE)
                .put("challengeId", UUID.randomUUID().toString())
                .put("enrollmentId", context.enrollmentId.toString()).put("deviceId", context.deviceId.toString())
                .put("installationId", context.installationId.toString())
                .put("installationGeneration", context.installationGeneration).put("enrollmentGeneration", context.enrollmentGeneration)
                .put("node", JSONObject().put("nodeId", "crypto-check-node").put("nodeKey", "crypto-check-key").put("networkRevision", 1))
                .put("nonce", "A".repeat(43)).put("issuedAt", now.minusSeconds(1).toString())
                .put("expiresAt", now.plusSeconds(60).toString()).toString()
            fun check(assertion: Boolean) { require(assertion); checks++ }
            fun rejected(operation: () -> Unit) {
                var failedClosed = false
                try { operation() } catch (error: IllegalStateException) {
                    failedClosed = error.message == "Installation challenge signing rejected" && error.cause == null
                }
                check(failedClosed)
            }
            val missing = EnrollmentSigningContext(expected.enrollmentId, expected.deviceId, missingId, "1", "1")
            rejected { EnrollmentKeySigner(missingId).sign(challenge(missing), missing, now) }
            val signer = EnrollmentKeySigner(installationId)
            val publicKeyText = signer.preparePublicKey()
            check(publicKeyText == EnrollmentKeySigner(installationId).preparePublicKey())
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            check(store.getKey(alias(installationId), null).encoded == null)
            check(!store.containsAlias(alias(missingId)))
            val raw = challenge()
            val signature = Base64.decode(signer.sign(raw, expected, now), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            check(signature.size == 64)
            val publicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.decode(publicKeyText, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)))
            P256SignatureEncoding.requireP256(publicKey)
            val verifier = Signature.getInstance("SHA256withECDSA")
            verifier.initVerify(publicKey); verifier.update(AdmissionContractBoundary.parse(raw).signingBytes())
            check(verifier.verify(toDer(signature)))
            rejected { signer.sign(raw, expected.copy(enrollmentGeneration = "2"), now) }
            rejected { signer.sign(raw, expected.copy(installationId = missingId), now) }
            rejected { signer.sign(raw, expected, now.plusSeconds(60)) }
            check(publicKeyText == signer.preparePublicKey())
            result.putInt("passed", checks)
            result.putInt("failed", 0)
            result.putString("stream", "Native enrollment crypto checks: $checks passed; no business admission asserted.\n")
        } catch (_: Exception) {
            result.putInt("passed", checks)
            result.putInt("failed", 1)
            result.putString("stream", "Native enrollment crypto checks failed; secret-bearing causes suppressed.\n")
        } finally {
            try {
                val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                for (id in listOf(installationId, missingId)) if (store.containsAlias(alias(id))) store.deleteEntry(alias(id))
                result.putBoolean("testKeysRemoved", true)
            } catch (_: Exception) {
                result.putInt("failed", 1)
                result.putBoolean("testKeysRemoved", false)
            }
        }
        finish(if (result.getInt("failed") == 0) Activity.RESULT_OK else Activity.RESULT_CANCELED, result)
    }

    private fun alias(id: UUID) = "socialgrowth-enrollment-p256-v1-$id"

    // Test-only independent ASN.1 encoder for the Android verifier; production
    // converts the opposite direction and never submits DER as protocol proof.
    private fun toDer(raw: ByteArray): ByteArray {
        fun integer(start: Int): ByteArray {
            var index = start
            while (index < start + 31 && raw[index].toInt() == 0) index++
            val magnitude = raw.copyOfRange(index, start + 32)
            val positive = if (magnitude[0].toInt() < 0) byteArrayOf(0) + magnitude else magnitude
            return byteArrayOf(2, positive.size.toByte()) + positive
        }
        val content = integer(0) + integer(32)
        return byteArrayOf(0x30, content.size.toByte()) + content
    }
}
