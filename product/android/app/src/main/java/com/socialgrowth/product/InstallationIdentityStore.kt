package com.socialgrowth.product

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.security.SecureRandom
import java.time.Instant
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class StoredInstallationIdentity(
    val credential: String,
    val installationId: String?,
    val generation: Long?,
    val sessionToken: String?,
    val sessionExpiresAt: String?,
    val associationSessionId: String?,
    val associationCode: String?,
    val associationExpiresAt: String?,
) {
    fun activeSessionToken(): String? = sessionToken?.takeIf {
        sessionExpiresAt?.let { expiry -> Instant.parse(expiry).isAfter(Instant.now()) } == true
    }

    fun activeAssociation(now: Instant = Instant.now()): AssociationSession? {
        val id = associationSessionId ?: return null
        val code = associationCode ?: return null
        val expiry = associationExpiresAt ?: return null
        if (!Instant.parse(expiry).isAfter(now)) return null
        return AssociationSession(UUID.fromString(id), code, expiry)
    }

    fun withAuth(auth: InstallationAuth): StoredInstallationIdentity {
        val sameInstallation = installationId == auth.installationId.toString() && generation == auth.generation
        return copy(
            installationId = auth.installationId.toString(), generation = auth.generation,
            sessionToken = auth.sessionToken, sessionExpiresAt = auth.sessionExpiresAt,
            associationSessionId = if (sameInstallation) associationSessionId else null,
            associationCode = if (sameInstallation) associationCode else null,
            associationExpiresAt = if (sameInstallation) associationExpiresAt else null,
        )
    }
}

class InstallationIdentityStore(context: Context) {
    private val preferences = context.getSharedPreferences("installation_identity", Context.MODE_PRIVATE)
    private val alias = "socialgrowth-installation-identity-v1"

    fun exists(): Boolean = preferences.contains("payload")

    fun ensureCredential(): StoredInstallationIdentity {
        load()?.let { return it }
        check(!exists()) { "Existing installation identity cannot be decrypted; refusing replacement" }
        val bytes = ByteArray(32).also(SecureRandom()::nextBytes)
        val credential = "sginst_v1_" + Base64.encodeToString(
            bytes,
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
        )
        return StoredInstallationIdentity(
            credential, null, null, null, null, null, null, null,
        ).also(::save)
    }

    fun saveAuth(current: StoredInstallationIdentity, auth: InstallationAuth): StoredInstallationIdentity {
        val next = current.withAuth(auth)
        save(next)
        return next
    }

    fun saveAssociation(
        current: StoredInstallationIdentity,
        association: AssociationSession,
    ): StoredInstallationIdentity = current.copy(
        associationSessionId = association.associationSessionId.toString(),
        associationCode = association.associationCode,
        associationExpiresAt = association.expiresAt,
    ).also(::save)

    fun clearAssociation(current: StoredInstallationIdentity): StoredInstallationIdentity = current.copy(
        associationSessionId = null,
        associationCode = null,
        associationExpiresAt = null,
    ).also(::save)

    fun load(): StoredInstallationIdentity? = try {
        val iv = preferences.getString("iv", null) ?: return null
        val payload = preferences.getString("payload", null) ?: return null
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            requireNotNull(existingKey()),
            GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)),
        )
        val json = JSONObject(String(cipher.doFinal(Base64.decode(payload, Base64.NO_WRAP)), Charsets.UTF_8))
        val credential = json.getString("credential")
        require(credential.matches(Regex("^sginst_v1_[A-Za-z0-9_-]{43}$")))
        val installationId = json.optString("installationId").takeIf(String::isNotEmpty)
        val generation = if (json.has("generation")) json.getLong("generation") else null
        val sessionToken = json.optString("sessionToken").takeIf(String::isNotEmpty)
        val sessionExpiresAt = json.optString("sessionExpiresAt").takeIf(String::isNotEmpty)
        val associationSessionId = json.optString("associationSessionId").takeIf(String::isNotEmpty)
        val associationCode = json.optString("associationCode").takeIf(String::isNotEmpty)
        val associationExpiresAt = json.optString("associationExpiresAt").takeIf(String::isNotEmpty)
        if (installationId != null) UUID.fromString(installationId)
        if (generation != null) require(generation > 0)
        if (sessionToken != null) require(sessionToken.matches(Regex("^[A-Za-z0-9_-]{43}$")))
        if (sessionExpiresAt != null) Instant.parse(sessionExpiresAt)
        if (associationSessionId != null) UUID.fromString(associationSessionId)
        if (associationCode != null) require(associationCode.matches(Regex("^sgassoc_v1_[A-Za-z0-9_-]{43}$")))
        if (associationExpiresAt != null) Instant.parse(associationExpiresAt)
        require(listOf(installationId, generation, sessionToken, sessionExpiresAt).all { it == null } ||
            listOf(installationId, generation, sessionToken, sessionExpiresAt).all { it != null })
        require(listOf(associationSessionId, associationCode, associationExpiresAt).all { it == null } ||
            listOf(associationSessionId, associationCode, associationExpiresAt).all { it != null })
        StoredInstallationIdentity(
            credential,
            installationId,
            generation,
            sessionToken,
            sessionExpiresAt,
            associationSessionId,
            associationCode,
            associationExpiresAt,
        )
    } catch (_: Exception) {
        null
    }

    private fun save(identity: StoredInstallationIdentity) {
        val json = JSONObject().put("credential", identity.credential)
        identity.installationId?.let { json.put("installationId", it) }
        identity.generation?.let { json.put("generation", it) }
        identity.sessionToken?.let { json.put("sessionToken", it) }
        identity.sessionExpiresAt?.let { json.put("sessionExpiresAt", it) }
        identity.associationSessionId?.let { json.put("associationSessionId", it) }
        identity.associationCode?.let { json.put("associationCode", it) }
        identity.associationExpiresAt?.let { json.put("associationExpiresAt", it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(json.toString().toByteArray(Charsets.UTF_8))
        check(preferences.edit()
            .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("payload", Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .commit()) { "Unable to persist installation identity" }
    }

    private fun getOrCreateKey(): SecretKey {
        existingKey()?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(
                alias,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    private fun existingKey(): SecretKey? {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return keyStore.getKey(alias, null) as? SecretKey
    }
}
