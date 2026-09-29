package com.socialgrowth.product

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.security.KeyStore
import java.time.Instant
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class StoredProviderSession(
    val providerId: String,
    val displayName: String,
    val phoneHint: String,
    val sessionToken: String,
    val expiresAt: String,
)

class ProviderSessionStore(context: Context) {
    private val preferences = context.getSharedPreferences("provider_session", Context.MODE_PRIVATE)
    private val alias = "socialgrowth-provider-session-v1"

    fun save(auth: ProviderAuthResult) {
        val plain = JSONObject()
            .put("providerId", auth.provider.providerId.toString())
            .put("displayName", auth.provider.displayName)
            .put("phoneHint", auth.provider.phoneHint)
            .put("sessionToken", auth.sessionToken)
            .put("expiresAt", auth.session.expiresAt)
            .toString()
            .toByteArray(Charsets.UTF_8)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encrypted = cipher.doFinal(plain)
        check(preferences.edit()
            .putString("iv", android.util.Base64.encodeToString(cipher.iv, android.util.Base64.NO_WRAP))
            .putString("payload", android.util.Base64.encodeToString(encrypted, android.util.Base64.NO_WRAP))
            .commit()) { "Unable to persist provider session" }
    }

    fun load(): StoredProviderSession? = try {
        val iv = preferences.getString("iv", null) ?: return null
        val payload = preferences.getString("payload", null) ?: return null
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.DECRYPT_MODE,
            getOrCreateKey(),
            GCMParameterSpec(128, android.util.Base64.decode(iv, android.util.Base64.NO_WRAP)),
        )
        val json = JSONObject(
            String(
                cipher.doFinal(android.util.Base64.decode(payload, android.util.Base64.NO_WRAP)),
                Charsets.UTF_8,
            ),
        )
        val session = StoredProviderSession(
            providerId = json.getString("providerId"),
            displayName = json.getString("displayName"),
            phoneHint = json.getString("phoneHint"),
            sessionToken = json.getString("sessionToken"),
            expiresAt = json.getString("expiresAt"),
        )
        require(session.sessionToken.matches(Regex("^[A-Za-z0-9_-]{43}$")))
        require(Instant.parse(session.expiresAt).isAfter(Instant.now()))
        session
    } catch (_: Exception) {
        clear()
        null
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
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
}
