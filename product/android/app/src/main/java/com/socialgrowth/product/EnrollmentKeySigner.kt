package com.socialgrowth.product

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.AlgorithmParameters
import java.security.interfaces.ECPublicKey
import java.security.spec.ECParameterSpec
import java.security.spec.ECGenParameterSpec
import java.time.Instant
import java.util.UUID

// Not wired to MainActivity or a network endpoint yet. No API/UI can use this as
// a shortcut to network admission; the server must independently check source.
internal class EnrollmentKeySigner(private val installationId: UUID) {
    private val alias = "socialgrowth-enrollment-p256-v1-$installationId"

    fun preparePublicKey(): String = synchronized(keyLock) {
        try {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            if (!store.containsAlias(alias)) {
                val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
                generator.initialize(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                    .setDigests(KeyProperties.DIGEST_SHA256).build())
                generator.generateKeyPair()
            }
            val publicKey = store.getCertificate(alias).publicKey
            P256SignatureEncoding.requireP256(publicKey)
            encode(publicKey.encoded)
        } catch (_: Exception) { throw IllegalStateException("Installation signing key unavailable") }
    }

    fun sign(rawChallenge: String, expected: EnrollmentSigningContext, now: Instant = Instant.now()): String {
        try {
            require(expected.installationId == installationId)
            val challenge = AdmissionContractBoundary.parse(rawChallenge)
            challenge.checkScope(expected, now)
            val key = synchronized(keyLock) {
                val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
                P256SignatureEncoding.requireP256(store.getCertificate(alias).publicKey)
                store.getKey(alias, null) as? PrivateKey ?: error("Missing signing key")
            }
            // A missing key is NOT regenerated during signing or used to claim
            // an old binding. The server also pins the original enrolled key.
            val signer = Signature.getInstance("SHA256withECDSA")
            signer.initSign(key)
            signer.update(challenge.signingBytes())
            return encode(P256SignatureEncoding.derToP1363(signer.sign()))
        } catch (_: Exception) { throw IllegalStateException("Installation challenge signing rejected") }
    }

    private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    companion object { private val keyLock = Any() }
}

internal object P256SignatureEncoding {
    fun requireP256(key: PublicKey) {
        require(key is ECPublicKey)
        val expected = AlgorithmParameters.getInstance("EC").apply {
            init(ECGenParameterSpec("secp256r1"))
        }.getParameterSpec(ECParameterSpec::class.java)
        val actual = key.params
        require(actual.curve == expected.curve && actual.generator == expected.generator &&
            actual.order == expected.order && actual.cofactor == expected.cofactor)
    }
    fun derToP1363(der: ByteArray): ByteArray {
        require(der.size in 8..72 && der[0].toInt() == 0x30)
        require((der[1].toInt() and 0xff) == der.size - 2)
        var offset = 2
        fun integer(): ByteArray {
            require(offset + 2 <= der.size && der[offset++].toInt() == 0x02)
            val length = der[offset++].toInt() and 0xff
            require(length in 1..33 && offset + length <= der.size)
            val value = der.copyOfRange(offset, offset + length)
            offset += length
            require(value[0].toInt() >= 0)
            val start = if (value[0].toInt() == 0 && length > 1) {
                require(value[1].toInt() < 0); 1
            } else 0
            require(length - start <= 32)
            return ByteArray(32).also { value.copyInto(it, 32 - (length - start), start) }
        }
        val result = integer() + integer()
        require(offset == der.size)
        return result
    }
}
