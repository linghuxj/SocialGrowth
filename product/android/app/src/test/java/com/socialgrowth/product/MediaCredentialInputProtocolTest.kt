package com.socialgrowth.product

import java.security.KeyPairGenerator
import java.security.Signature
import java.math.BigInteger
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class MediaCredentialInputProtocolTest {
    @Test
    fun helloScopeIsStrictAndRoundTripsOnlyTheDefinedFields() {
        val scope = scope()
        val encoded = scope.encodeHelloRequest()
        assertContentEquals(encoded, MediaCredentialInputScope.decodeHelloRequest(encoded).encodeHelloRequest())
        assertFailsWith<IllegalArgumentException> {
            MediaCredentialInputScope.decodeHelloRequest(encoded + byteArrayOf(0))
        }
        assertFailsWith<IllegalArgumentException> {
            scope.copy(targetPackage = "com.example.untrusted").encodeHelloRequest()
        }
    }

    @Test
    fun statusReceiptIsInstallationSignedAndBindsSessionAndActionWithoutClearPhase() {
        val scope = scope()
        val nonce = ByteArray(32) { (it + 1).toByte() }
        val helloDigest = ByteArray(32) { (it + 4).toByte() }
        val prefix = mediaCredentialInputStatusPrefix(
            deviceId = scope.deviceId,
            installationId = scope.installationId,
            installationGeneration = scope.installationGeneration,
            sessionNonce = nonce,
            requestId = scope.requestId,
            actionId = scope.actionId,
            helloRequestDigest = helloDigest,
            sequence = 1,
            phase = MediaCredentialInputPhase.BLOCKED_REQUIRES_HUMAN_CLEAR,
        )
        val keyPair = KeyPairGenerator.getInstance("EC").apply {
            initialize(java.security.spec.ECGenParameterSpec("secp256r1"))
        }.generateKeyPair()
        val signature = Signature.getInstance("SHA256withECDSA").run {
            initSign(keyPair.private)
            update(mediaCredentialInputStatusSignatureInput(prefix))
            normalizeLowS(sign())
        }
        val frame = prefix + byteArrayOf(signature.size.toByte()) + signature
        val decoded = MediaCredentialInputStatus.decode(frame)
        assertTrue(decoded.verify(keyPair.public))
        assertTrue(decoded.phase == MediaCredentialInputPhase.BLOCKED_REQUIRES_HUMAN_CLEAR)
        assertFalse(MediaCredentialInputPhase.entries.any { it.name == "CLEAR" })

        val changed = frame.copyOf().also { it[29] = (it[29].toInt() xor 0x01).toByte() }
        assertFalse(MediaCredentialInputStatus.decode(changed).verify(keyPair.public))
        assertFailsWith<IllegalArgumentException> {
            MediaCredentialInputStatus.decode(frame + byteArrayOf(0))
        }
    }

    private fun scope() = MediaCredentialInputScope(
        accountId = UUID.randomUUID(),
        credentialId = UUID.randomUUID(),
        projectId = UUID.randomUUID(),
        taskId = UUID.randomUUID(),
        taskAttemptId = UUID.randomUUID(),
        actionId = UUID.randomUUID(),
        requestId = UUID.randomUUID(),
        authorizationId = UUID.randomUUID(),
        holderId = UUID.randomUUID(),
        deviceId = UUID.randomUUID(),
        installationId = UUID.randomUUID(),
        credentialRevision = 3,
        installationGeneration = 2,
        controlGeneration = 4,
        leaseUntilMillis = 2_000_000_000_000,
        holderGrantValidUntilMillis = 2_000_000_000_000,
        operationKind = MediaCredentialOperationKind.ASSIST_EXISTING_LOGIN,
        platform = MediaAccountPlatform.FACEBOOK,
        serial = "R58M123456A",
        targetPackage = "com.facebook.katana",
        targetViewIdResourceName = null,
        field = MediaCredentialField.PASSWORD,
    ).let { it.copy(requestId = it.actionId) }

    private fun normalizeLowS(der: ByteArray): ByteArray {
        var offset = 2
        fun integer(): BigInteger {
            check(der[offset++].toInt() == 2)
            val length = der[offset++].toInt() and 0xff
            return BigInteger(1, der.copyOfRange(offset, offset + length)).also { offset += length }
        }
        val r = integer()
        val s = integer()
        val order = BigInteger("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)
        val normalizedS = if (s > order.shiftRight(1)) order - s else s
        fun encodedInteger(value: BigInteger): ByteArray {
            val raw = value.toByteArray()
            return byteArrayOf(2, raw.size.toByte()) + raw
        }
        val body = encodedInteger(r) + encodedInteger(normalizedS)
        return ByteArrayOutputStream().also { bytes ->
            DataOutputStream(bytes).use { output ->
                output.writeByte(0x30)
                output.writeByte(body.size)
                output.write(body)
            }
        }.toByteArray()
    }
}
