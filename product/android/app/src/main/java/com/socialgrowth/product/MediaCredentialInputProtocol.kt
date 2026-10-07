package com.socialgrowth.product

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.math.BigInteger
import java.security.MessageDigest
import java.security.PublicKey
import java.security.Signature
import java.security.spec.MGF1ParameterSpec
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.OAEPParameterSpec
import javax.crypto.spec.PSource
import javax.crypto.spec.SecretKeySpec

internal enum class MediaCredentialField(val wireValue: Int) {
    LOGIN(1),
    PASSWORD(2),
    SUBMIT_LOGIN(3);

    companion object {
        fun fromWire(value: Int): MediaCredentialField = entries.firstOrNull { it.wireValue == value }
            ?: throw IllegalArgumentException("invalid field")
    }
}

internal enum class MediaAccountPlatform(val wireValue: Int) {
    FACEBOOK(1),
    YOUTUBE(2);

    companion object {
        fun fromWire(value: Int): MediaAccountPlatform = entries.firstOrNull { it.wireValue == value }
            ?: throw IllegalArgumentException("invalid platform")
    }
}

internal enum class MediaCredentialOperationKind(val wireValue: Int) {
    ASSIST_EXISTING_LOGIN(1),
    ;

    companion object {
        fun fromWire(value: Int): MediaCredentialOperationKind = entries.firstOrNull { it.wireValue == value }
            ?: throw IllegalArgumentException("invalid operation kind")
    }
}

/** Authenticated intent supplied by the executor and confirmed against local installation state. */
internal data class MediaCredentialInputScope(
    val accountId: UUID,
    val credentialId: UUID,
    val projectId: UUID,
    val taskId: UUID,
    val taskAttemptId: UUID,
    val actionId: UUID,
    val requestId: UUID,
    val authorizationId: UUID,
    val holderId: UUID,
    val deviceId: UUID,
    val installationId: UUID,
    val credentialRevision: Long,
    val installationGeneration: Long,
    val controlGeneration: Long,
    val leaseUntilMillis: Long,
    val holderGrantValidUntilMillis: Long,
    val operationKind: MediaCredentialOperationKind,
    val platform: MediaAccountPlatform,
    val serial: String,
    val targetPackage: String,
    val targetViewIdResourceName: String?,
    val field: MediaCredentialField,
) {
    fun encodeHelloRequest(): ByteArray {
        validate()
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use { output ->
            output.write(HELLO_MAGIC)
            output.writeByte(PROTOCOL_VERSION)
            writeScopeFields(output, this)
        }
        return bytes.toByteArray()
    }

    fun validate() {
        require(requestId == actionId)
        require(credentialRevision > 0 && installationGeneration > 0 && controlGeneration > 0)
        require(leaseUntilMillis > 0 && holderGrantValidUntilMillis > 0)
        require(serial.toByteArray(StandardCharsets.UTF_8).size in 1..MAX_SERIAL_BYTES)
        require(serial.none(Char::isISOControl))
        require(PACKAGE_PATTERN.matches(targetPackage))
        require(targetPackage.toByteArray(StandardCharsets.US_ASCII).size in 1..MAX_PACKAGE_BYTES)
        require(targetPackage == when (platform) {
            MediaAccountPlatform.FACEBOOK -> FACEBOOK_PACKAGE
            MediaAccountPlatform.YOUTUBE -> YOUTUBE_PACKAGE
        })
        if (field == MediaCredentialField.SUBMIT_LOGIN) {
            require(targetViewIdResourceName != null && targetViewIdResourceName.startsWith("$targetPackage:id/"))
            require(VIEW_ID_PATTERN.matches(targetViewIdResourceName))
        } else {
            require(targetViewIdResourceName == null)
        }
    }

    companion object {
        fun decodeHelloRequest(bytes: ByteArray): MediaCredentialInputScope {
            require(bytes.size <= MAX_HELLO_BYTES)
            val input = DataInputStream(ByteArrayInputStream(bytes))
            require(readExact(input, HELLO_MAGIC.size).contentEquals(HELLO_MAGIC))
            require(input.readUnsignedByte() == PROTOCOL_VERSION)
            val value = readScopeFields(input)
            require(input.available() == 0)
            value.validate()
            return value
        }
    }
}

internal data class MediaCredentialGrantClaims(
    val scope: MediaCredentialInputScope,
    val issuedAtMillis: Long,
    val expiresAtMillis: Long,
    val sessionNonce: ByteArray,
    val devicePublicKeyDigest: ByteArray,
    val helloProofDigest: ByteArray,
    val grantNonce: ByteArray,
    val priorPasswordActionId: UUID?,
    val priorPasswordStatusFrameDigest: ByteArray?,
    val priorPasswordSessionNonce: ByteArray?,
)

/** A status receipt is bound to one live HELLO and cannot authorize another action. */
internal enum class MediaCredentialInputPhase(val wireValue: Int) {
    HELLO_READY(1),
    INPUT_REJECTED(2),
    INPUT_APPLIED_QUARANTINED(3),
    SUBMIT_APPLIED_QUARANTINED(4),
    BLOCKED_REQUIRES_HUMAN_CLEAR(5),
    SERVICE_STOPPED_QUARANTINED(6),
    ;

    companion object {
        fun fromWire(value: Int): MediaCredentialInputPhase = entries.firstOrNull { it.wireValue == value }
            ?: throw IllegalArgumentException("invalid phase")
    }
}

internal data class MediaCredentialInputStatus(
    val deviceId: UUID,
    val installationId: UUID,
    val installationGeneration: Long,
    val sessionNonce: ByteArray,
    val requestId: UUID,
    val actionId: UUID,
    val helloRequestDigest: ByteArray,
    val sequence: Long,
    val phase: MediaCredentialInputPhase,
    val signatureDer: ByteArray,
    private val signedPrefix: ByteArray,
) {
    fun verify(publicKey: PublicKey): Boolean = try {
        P256SignatureEncoding.requireP256(publicKey)
        Signature.getInstance("SHA256withECDSA").run {
            initVerify(publicKey)
            update(STATUS_SIGNATURE_DOMAIN)
            update(signedPrefix)
            verify(signatureDer)
        }
    } catch (_: Exception) { false }

    companion object {
        fun decode(bytes: ByteArray): MediaCredentialInputStatus {
            require(bytes.size in MIN_STATUS_BYTES..MAX_STATUS_BYTES)
            val input = DataInputStream(ByteArrayInputStream(bytes))
            require(readExact(input, STATUS_MAGIC.size).contentEquals(STATUS_MAGIC))
            require(input.readUnsignedByte() == PROTOCOL_VERSION)
            val deviceId = readUuid(input)
            val installationId = readUuid(input)
            val generation = input.readLong()
            val nonce = readExact(input, NONCE_BYTES)
            val requestId = readUuid(input)
            val actionId = readUuid(input)
            val helloDigest = readExact(input, SHA256_BYTES)
            val sequence = input.readLong()
            val phase = MediaCredentialInputPhase.fromWire(input.readUnsignedByte())
            val prefixLength = bytes.size - input.available()
            val prefix = bytes.copyOfRange(0, prefixLength)
            val signatureLength = input.readUnsignedByte()
            require(signatureLength in 8..MAX_ECDSA_DER_BYTES)
            val signature = readExact(input, signatureLength)
            require(input.available() == 0 && isCanonicalP256DerSignature(signature))
            require(generation > 0 && sequence > 0 && requestId == actionId)
            return MediaCredentialInputStatus(
                deviceId, installationId, generation, nonce, requestId, actionId,
                helloDigest, sequence, phase, signature, prefix,
            )
        }
    }
}

internal fun mediaCredentialInputStatusSignatureInput(prefix: ByteArray): ByteArray {
    require(prefix.size == STATUS_PREFIX_BYTES)
    return STATUS_SIGNATURE_DOMAIN + prefix
}

internal fun mediaCredentialInputStatusPrefix(
    deviceId: UUID,
    installationId: UUID,
    installationGeneration: Long,
    sessionNonce: ByteArray,
    requestId: UUID,
    actionId: UUID,
    helloRequestDigest: ByteArray,
    sequence: Long,
    phase: MediaCredentialInputPhase,
): ByteArray {
    require(installationGeneration > 0 && sequence > 0 && requestId == actionId)
    require(sessionNonce.size == NONCE_BYTES && helloRequestDigest.size == SHA256_BYTES)
    val bytes = ByteArrayOutputStream()
    DataOutputStream(bytes).use { output ->
        output.write(STATUS_MAGIC)
        output.writeByte(PROTOCOL_VERSION)
        writeUuid(output, deviceId)
        writeUuid(output, installationId)
        output.writeLong(installationGeneration)
        output.write(sessionNonce)
        writeUuid(output, requestId)
        writeUuid(output, actionId)
        output.write(helloRequestDigest)
        output.writeLong(sequence)
        output.writeByte(phase.wireValue)
    }
    return bytes.toByteArray()
}

internal data class SealedMediaCredential(
    val keyId: String,
    val rawGrantPayload: ByteArray,
    val wrappedAesKey: ByteArray,
    val iv: ByteArray,
    val ciphertext: ByteArray,
    val tag: ByteArray,
    val hasSecret: Boolean,
    val signatureDer: ByteArray,
    private val signedFramePrefix: ByteArray,
) {
    fun signatureInput(): ByteArray = ENVELOPE_SIGNATURE_DOMAIN + signedFramePrefix

    fun claims(): MediaCredentialGrantClaims = decodeGrantPayload(rawGrantPayload)

    fun envelopeDigest(): ByteArray = MessageDigest.getInstance("SHA-256").digest(
        signedFramePrefix + byteArrayOf(signatureDer.size.toByte()) + signatureDer,
    )

    fun verifySignature(publicKey: PublicKey): Boolean = try {
        P256SignatureEncoding.requireP256(publicKey)
        Signature.getInstance("SHA256withECDSA").run {
            initVerify(publicKey)
            update(ENVELOPE_SIGNATURE_DOMAIN)
            update(signedFramePrefix)
            verify(signatureDer)
        }
    } catch (_: Exception) {
        false
    }

    fun decrypt(privateKey: java.security.PrivateKey): ByteArray {
        require(hasSecret)
        val wrap = Cipher.getInstance("RSA/ECB/OAEPPadding")
        wrap.init(
            Cipher.DECRYPT_MODE,
            privateKey,
            OAEPParameterSpec(
                "SHA-256",
                "MGF1",
                MGF1ParameterSpec.SHA256,
                PSource.PSpecified.DEFAULT,
            ),
        )
        val keyBytes = wrap.doFinal(wrappedAesKey)
        require(keyBytes.size == AES_KEY_BYTES)
        try {
            val gcm = Cipher.getInstance("AES/GCM/NoPadding")
            gcm.init(Cipher.DECRYPT_MODE, SecretKeySpec(keyBytes, "AES"), GCMParameterSpec(GCM_TAG_BITS, iv))
            gcm.updateAAD(rawGrantPayload)
            return gcm.doFinal(ciphertext + tag)
        } finally {
            keyBytes.fill(0)
        }
    }

    companion object {
        fun decode(frame: ByteArray): SealedMediaCredential {
            require(frame.size <= MAX_ENVELOPE_BYTES)
            val input = DataInputStream(ByteArrayInputStream(frame))
            val magic = readExact(input, ENVELOPE_MAGIC.size)
            require(magic.contentEquals(ENVELOPE_MAGIC))
            require(input.readUnsignedByte() == PROTOCOL_VERSION)
            val keyIdLength = input.readUnsignedByte()
            require(keyIdLength in 1..MAX_KEY_ID_BYTES)
            val keyId = readAscii(input, keyIdLength)
            require(KEY_ID_PATTERN.matches(keyId))
            val payloadLength = input.readInt()
            require(payloadLength in 1..MAX_GRANT_PAYLOAD_BYTES)
            val payload = readExact(input, payloadLength)
            val claims = decodeGrantPayload(payload)
            val hasSecret = when (input.readUnsignedByte()) {
                ENVELOPE_WITH_SECRET -> true
                ENVELOPE_WITHOUT_SECRET -> false
                else -> throw IllegalArgumentException("invalid envelope mode")
            }
            val wrapped: ByteArray
            val iv: ByteArray
            val ciphertext: ByteArray
            val tag: ByteArray
            if (hasSecret) {
                require(claims.scope.field != MediaCredentialField.SUBMIT_LOGIN)
                val wrappedLength = input.readUnsignedShort()
                require(wrappedLength == RSA2048_BYTES)
                wrapped = readExact(input, wrappedLength)
                iv = readExact(input, GCM_IV_BYTES)
                val ciphertextLength = input.readInt()
                require(ciphertextLength in 1..MAX_SECRET_BYTES)
                ciphertext = readExact(input, ciphertextLength)
                tag = readExact(input, GCM_TAG_BYTES)
            } else {
                require(claims.scope.field == MediaCredentialField.SUBMIT_LOGIN)
                wrapped = ByteArray(0)
                iv = ByteArray(0)
                ciphertext = ByteArray(0)
                tag = ByteArray(0)
            }
            val signedPrefixLength = frame.size - input.available()
            val signedPrefix = frame.copyOfRange(0, signedPrefixLength)
            val signatureLength = input.readUnsignedByte()
            require(signatureLength in 8..MAX_ECDSA_DER_BYTES)
            val signature = readExact(input, signatureLength)
            require(input.available() == 0)
            require(isCanonicalP256DerSignature(signature))
            return SealedMediaCredential(keyId, payload, wrapped, iv, ciphertext, tag, hasSecret, signature, signedPrefix)
        }
    }
}

internal fun decodeGrantPayload(bytes: ByteArray): MediaCredentialGrantClaims {
    require(bytes.size <= MAX_GRANT_PAYLOAD_BYTES)
    val input = DataInputStream(ByteArrayInputStream(bytes))
    require(readExact(input, GRANT_MAGIC.size).contentEquals(GRANT_MAGIC))
    require(input.readUnsignedByte() == PROTOCOL_VERSION)
    val scope = readScopeFields(input)
    val issuedAtMillis = input.readLong()
    val expiresAtMillis = input.readLong()
    val sessionNonce = readExact(input, NONCE_BYTES)
    val publicKeyDigest = readExact(input, SHA256_BYTES)
    val helloProofDigest = readExact(input, SHA256_BYTES)
    val grantNonce = readExact(input, NONCE_BYTES)
    val priorPasswordActionId: UUID?
    val priorPasswordStatusFrameDigest: ByteArray?
    val priorPasswordSessionNonce: ByteArray?
    if (scope.field == MediaCredentialField.SUBMIT_LOGIN) {
        priorPasswordActionId = readUuid(input)
        priorPasswordStatusFrameDigest = readExact(input, SHA256_BYTES)
        priorPasswordSessionNonce = readExact(input, NONCE_BYTES)
    } else {
        priorPasswordActionId = null
        priorPasswordStatusFrameDigest = null
        priorPasswordSessionNonce = null
    }
    require(input.available() == 0)
    require(scope.actionId == scope.requestId)
    require(scope.credentialRevision > 0 && scope.installationGeneration > 0 && scope.controlGeneration > 0)
    require(issuedAtMillis > 0 && expiresAtMillis > issuedAtMillis)
    require(scope.leaseUntilMillis > 0 && scope.holderGrantValidUntilMillis > 0)
    return MediaCredentialGrantClaims(
        scope,
        issuedAtMillis,
        expiresAtMillis,
        sessionNonce,
        publicKeyDigest,
        helloProofDigest,
        grantNonce,
        priorPasswordActionId,
        priorPasswordStatusFrameDigest,
        priorPasswordSessionNonce,
    )
}

internal fun validateGrantScope(
    claims: MediaCredentialGrantClaims,
    expected: MediaCredentialInputScope,
    sessionNonce: ByteArray,
    publicKeySpki: ByteArray,
    helloProof: ByteArray,
    nowMillis: Long,
): Boolean {
    val scope = claims.scope
    if (!runCatching { scope.encodeHelloRequest().contentEquals(expected.encodeHelloRequest()) }.getOrDefault(false)) return false
    if (!MessageDigest.isEqual(sessionNonce, claims.sessionNonce)) return false
    if (!MessageDigest.isEqual(sha256(publicKeySpki), claims.devicePublicKeyDigest)) return false
    if (!MessageDigest.isEqual(sha256(helloProof), claims.helloProofDigest)) return false
    if (claims.issuedAtMillis > nowMillis + MAX_CLOCK_SKEW_MS) return false
    if (claims.expiresAtMillis <= nowMillis || claims.expiresAtMillis - claims.issuedAtMillis > MAX_GRANT_AGE_MS) return false
    if (claims.expiresAtMillis > minOf(scope.leaseUntilMillis, scope.holderGrantValidUntilMillis)) return false
    if (scope.leaseUntilMillis <= nowMillis || scope.holderGrantValidUntilMillis <= nowMillis) return false
    return true
}

internal fun decryptCredentialField(envelope: SealedMediaCredential, privateKey: java.security.PrivateKey): CharArray {
    val plaintext = envelope.decrypt(privateKey)
    try {
        val decoded = StandardCharsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(plaintext))
        require(decoded.remaining() in 1..MAX_SECRET_CHARS)
        val chars = CharArray(decoded.remaining())
        decoded.get(chars)
        if (decoded.hasArray()) decoded.array().fill('\u0000')
        require(chars.none(Char::isISOControl))
        return chars
    } finally {
        plaintext.fill(0)
    }
}

internal fun isPasswordInputType(inputType: Int): Boolean {
    val inputClass = inputType and android.text.InputType.TYPE_MASK_CLASS
    val variation = inputType and android.text.InputType.TYPE_MASK_VARIATION
    return when (inputClass) {
        android.text.InputType.TYPE_CLASS_TEXT -> variation in setOf(
            android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD,
            android.text.InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
        )
        android.text.InputType.TYPE_CLASS_NUMBER -> variation == android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD
        else -> false
    }
}

internal fun verifyMediaHelloSignature(message: ByteArray, signatureDer: ByteArray, publicKey: PublicKey): Boolean = try {
    P256SignatureEncoding.requireP256(publicKey)
    Signature.getInstance("SHA256withECDSA").run {
        initVerify(publicKey)
        update(HELLO_SIGNATURE_DOMAIN)
        update(message)
        verify(signatureDer)
    }
} catch (_: Exception) {
    false
}

internal fun mediaHelloSignatureInput(request: ByteArray, sessionNonce: ByteArray, publicKeySpki: ByteArray): ByteArray {
    require(sessionNonce.size == NONCE_BYTES && publicKeySpki.size in 1..MAX_RSA_SPKI_BYTES)
    val output = ByteArrayOutputStream()
    DataOutputStream(output).use { data ->
        data.write(HELLO_SIGNATURE_DOMAIN)
        data.writeInt(request.size)
        data.write(request)
        data.write(sessionNonce)
        data.writeShort(publicKeySpki.size)
        data.write(publicKeySpki)
    }
    return output.toByteArray()
}

private fun readScopeFields(input: DataInputStream): MediaCredentialInputScope = MediaCredentialInputScope(
    accountId = readUuid(input),
    credentialId = readUuid(input),
    projectId = readUuid(input),
    taskId = readUuid(input),
    taskAttemptId = readUuid(input),
    operationKind = MediaCredentialOperationKind.fromWire(input.readUnsignedByte()),
    actionId = readUuid(input),
    requestId = readUuid(input),
    authorizationId = readUuid(input),
    holderId = readUuid(input),
    deviceId = readUuid(input),
    installationId = readUuid(input),
    credentialRevision = input.readLong(),
    installationGeneration = input.readLong(),
    controlGeneration = input.readLong(),
    leaseUntilMillis = input.readLong(),
    holderGrantValidUntilMillis = input.readLong(),
    platform = MediaAccountPlatform.fromWire(input.readUnsignedByte()),
    serial = readShortUtf8(input, MAX_SERIAL_BYTES),
    targetPackage = readShortAscii(input, MAX_PACKAGE_BYTES),
    targetViewIdResourceName = readOptionalShortAscii(input, MAX_VIEW_ID_BYTES),
    field = MediaCredentialField.fromWire(input.readUnsignedByte()),
).also(MediaCredentialInputScope::validate)

private fun writeScopeFields(output: DataOutputStream, scope: MediaCredentialInputScope) {
    writeUuid(output, scope.accountId)
    writeUuid(output, scope.credentialId)
    writeUuid(output, scope.projectId)
    writeUuid(output, scope.taskId)
    writeUuid(output, scope.taskAttemptId)
    output.writeByte(scope.operationKind.wireValue)
    writeUuid(output, scope.actionId)
    writeUuid(output, scope.requestId)
    writeUuid(output, scope.authorizationId)
    writeUuid(output, scope.holderId)
    writeUuid(output, scope.deviceId)
    writeUuid(output, scope.installationId)
    output.writeLong(scope.credentialRevision)
    output.writeLong(scope.installationGeneration)
    output.writeLong(scope.controlGeneration)
    output.writeLong(scope.leaseUntilMillis)
    output.writeLong(scope.holderGrantValidUntilMillis)
    output.writeByte(scope.platform.wireValue)
    writeShortUtf8(output, scope.serial, MAX_SERIAL_BYTES)
    writeShortAscii(output, scope.targetPackage, MAX_PACKAGE_BYTES)
    writeOptionalShortAscii(output, scope.targetViewIdResourceName, MAX_VIEW_ID_BYTES)
    output.writeByte(scope.field.wireValue)
}

private fun readUuid(input: DataInputStream): UUID = ByteBuffer.wrap(readExact(input, UUID_BYTES)).let {
    UUID(it.long, it.long)
}

private fun writeUuid(output: DataOutputStream, value: UUID) {
    val bytes = ByteBuffer.allocate(UUID_BYTES).putLong(value.mostSignificantBits).putLong(value.leastSignificantBits).array()
    output.write(bytes)
}

private fun readExact(input: DataInputStream, size: Int): ByteArray {
    require(size >= 0 && size <= MAX_ENVELOPE_BYTES)
    return ByteArray(size).also(input::readFully)
}

private fun readShortUtf8(input: DataInputStream, maxBytes: Int): String {
    val length = input.readUnsignedShort()
    require(length in 1..maxBytes)
    val bytes = readExact(input, length)
    val decoder = StandardCharsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
    return decoder.decode(ByteBuffer.wrap(bytes)).toString().also { bytes.fill(0) }
}

private fun readShortAscii(input: DataInputStream, maxBytes: Int): String {
    val length = input.readUnsignedShort()
    require(length in 1..maxBytes)
    val bytes = readExact(input, length)
    require(bytes.all { (it.toInt() and 0xff) in 0x21..0x7e })
    return String(bytes, StandardCharsets.US_ASCII).also { bytes.fill(0) }
}

private fun readOptionalShortAscii(input: DataInputStream, maxBytes: Int): String? {
    val length = input.readUnsignedShort()
    require(length in 0..maxBytes)
    if (length == 0) return null
    val bytes = readExact(input, length)
    require(bytes.all { (it.toInt() and 0xff) in 0x21..0x7e })
    return String(bytes, StandardCharsets.US_ASCII).also { bytes.fill(0) }
}

private fun readAscii(input: DataInputStream, length: Int): String {
    val bytes = readExact(input, length)
    require(bytes.all { (it.toInt() and 0xff) in 0x21..0x7e })
    return String(bytes, StandardCharsets.US_ASCII).also { bytes.fill(0) }
}

private fun writeShortUtf8(output: DataOutputStream, value: String, maxBytes: Int) {
    val encoded = value.toByteArray(StandardCharsets.UTF_8)
    require(encoded.size in 1..maxBytes)
    output.writeShort(encoded.size)
    output.write(encoded)
    encoded.fill(0)
}

private fun writeShortAscii(output: DataOutputStream, value: String, maxBytes: Int) {
    require(value.all { it.code in 0x21..0x7e })
    val encoded = value.toByteArray(StandardCharsets.US_ASCII)
    require(encoded.size in 1..maxBytes)
    output.writeShort(encoded.size)
    output.write(encoded)
}

private fun writeOptionalShortAscii(output: DataOutputStream, value: String?, maxBytes: Int) {
    if (value == null) {
        output.writeShort(0)
        return
    }
    require(value.all { it.code in 0x21..0x7e })
    val encoded = value.toByteArray(StandardCharsets.US_ASCII)
    require(encoded.size in 1..maxBytes)
    output.writeShort(encoded.size)
    output.write(encoded)
}

private fun isCanonicalP256DerSignature(signature: ByteArray): Boolean = try {
    require(signature.size in 8..MAX_ECDSA_DER_BYTES)
    val raw = P256SignatureEncoding.derToP1363(signature)
    val r = BigInteger(1, raw.copyOfRange(0, 32))
    val s = BigInteger(1, raw.copyOfRange(32, 64))
    require(r.signum() > 0 && r < P256_ORDER)
    require(s.signum() > 0 && s <= P256_ORDER.shiftRight(1))
    true
} catch (_: Exception) {
    false
}

private fun sha256(value: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(value)

private const val PROTOCOL_VERSION = 1
private const val UUID_BYTES = 16
private const val NONCE_BYTES = 32
private const val SHA256_BYTES = 32
private const val AES_KEY_BYTES = 32
private const val RSA2048_BYTES = 256
private const val GCM_IV_BYTES = 12
private const val GCM_TAG_BYTES = 16
private const val GCM_TAG_BITS = 128
private const val MAX_SERIAL_BYTES = 128
private const val MAX_PACKAGE_BYTES = 255
private const val MAX_VIEW_ID_BYTES = 255
private const val MAX_KEY_ID_BYTES = 64
private const val MAX_GRANT_PAYLOAD_BYTES = 2048
private const val MAX_SECRET_BYTES = 4096
private const val MAX_SECRET_CHARS = 4096
private const val MAX_RSA_SPKI_BYTES = 1024
private const val MAX_ECDSA_DER_BYTES = 72
private const val MAX_ENVELOPE_BYTES = 8192
private const val MAX_HELLO_BYTES = 1024
private const val MAX_CLOCK_SKEW_MS = 5_000L
private const val MAX_GRANT_AGE_MS = 30_000L
private val HELLO_MAGIC = byteArrayOf('S'.code.toByte(), 'G'.code.toByte(), 'M'.code.toByte(), 'H'.code.toByte())
private val GRANT_MAGIC = byteArrayOf('S'.code.toByte(), 'G'.code.toByte(), 'M'.code.toByte(), 'P'.code.toByte())
private val ENVELOPE_MAGIC = byteArrayOf('S'.code.toByte(), 'G'.code.toByte(), 'M'.code.toByte(), 'E'.code.toByte())
private val STATUS_MAGIC = byteArrayOf('S'.code.toByte(), 'G'.code.toByte(), 'M'.code.toByte(), 'S'.code.toByte())
private val HELLO_SIGNATURE_DOMAIN = "SG-MEDIA-CREDENTIAL-INPUT-HELLO-V1\u0000".toByteArray(StandardCharsets.US_ASCII)
private val ENVELOPE_SIGNATURE_DOMAIN = "SG-MEDIA-CREDENTIAL-INPUT-ENVELOPE-V1\u0000".toByteArray(StandardCharsets.US_ASCII)
private val STATUS_SIGNATURE_DOMAIN = "SG-MEDIA-CREDENTIAL-INPUT-STATUS-V1\u0000".toByteArray(StandardCharsets.US_ASCII)
private val PACKAGE_PATTERN = Regex("^[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+$")
private val KEY_ID_PATTERN = Regex("^[a-f0-9]{64}$")
private val VIEW_ID_PATTERN = Regex("^[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+:id/[A-Za-z0-9_]+$")
private const val ENVELOPE_WITHOUT_SECRET = 0
private const val ENVELOPE_WITH_SECRET = 1
private val P256_ORDER = BigInteger("FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", 16)
private const val FACEBOOK_PACKAGE = "com.facebook.katana"
private const val YOUTUBE_PACKAGE = "com.google.android.youtube"
private const val STATUS_PREFIX_BYTES = 4 + 1 + 16 + 16 + 8 + 32 + 16 + 16 + 32 + 8 + 1
private const val MIN_STATUS_BYTES = STATUS_PREFIX_BYTES + 1 + 8
private const val MAX_STATUS_BYTES = MIN_STATUS_BYTES + 72
