package com.socialgrowth.product

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.nio.charset.StandardCharsets
import java.util.UUID

class ProviderApiException(
    val code: String,
    override val message: String,
    val retryable: Boolean,
) : Exception(message)

class ProviderApiClient(private val baseUrl: String) {
    companion object {
        const val CONTRACT_VERSION = "2026-09-29.identity-v1"
    }

    fun requestVerification(
        phoneE164: String,
        purpose: String,
        invitationCode: String?,
        idempotencyKey: String,
    ): PhoneVerificationChallenge {
        val body = JSONObject()
            .put("metadata", metadata(idempotencyKey))
            .put("purpose", purpose)
            .put("phoneE164", phoneE164)
        if (purpose == "provider_registration") {
            body.put("invitationCode", invitationCode)
        }
        return FirstBatchContractBoundary.parsePhoneVerificationChallenge(
            post("/api/provider/phone-verifications", body),
        )
    }

    fun verifyCode(
        challengeId: UUID,
        code: String,
        idempotencyKey: String,
    ): PhoneVerificationProof = FirstBatchContractBoundary.parsePhoneVerificationProof(
        post(
            "/api/provider/phone-verifications/verify",
            JSONObject()
                .put("metadata", metadata(idempotencyKey))
                .put("challengeId", challengeId.toString())
                .put("code", code),
        ),
    )

    fun register(
        invitationCode: String,
        phoneVerificationId: UUID,
        idempotencyKey: String,
    ): ProviderAuthResult = FirstBatchContractBoundary.parseProviderRegistrationAuthResponse(
        post(
            "/api/provider/register",
            JSONObject()
                .put("metadata", metadata(idempotencyKey))
                .put("invitationCode", invitationCode)
                .put("phoneVerificationId", phoneVerificationId.toString()),
        ),
    ).auth

    fun login(
        phoneVerificationId: UUID,
        idempotencyKey: String,
    ): ProviderAuthResult = FirstBatchContractBoundary.parseProviderAuthResponse(
        post(
            "/api/provider/login",
            JSONObject()
                .put("metadata", metadata(idempotencyKey))
                .put("phoneVerificationId", phoneVerificationId.toString()),
        ),
    )

    fun logout(sessionToken: String, idempotencyKey: String) {
        post(
            "/api/provider/logout",
            JSONObject().put("metadata", metadata(idempotencyKey)),
            sessionToken,
        )
    }

    internal fun metadata(idempotencyKey: String): JSONObject = JSONObject()
        .put("contractVersion", CONTRACT_VERSION)
        .put("requestId", "android-${UUID.randomUUID()}")
        .put("idempotencyKey", idempotencyKey)

    internal fun post(path: String, body: JSONObject, bearerToken: String? = null): String {
        val connection = (URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection)
        try {
            connection.requestMethod = "POST"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 10_000
            // Pairing includes a remote handshake and target verification.
            connection.readTimeout = if (path == "/api/provider/device-connection/pair") 45_000 else 15_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            connection.setRequestProperty("Accept", "application/json")
            if (bearerToken != null) {
                connection.setRequestProperty("Authorization", "Bearer $bearerToken")
            }
            connection.outputStream.use { output ->
                output.write(body.toString().toByteArray(StandardCharsets.UTF_8))
            }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { it.readNBytes(262145) } ?: ByteArray(0)
            require(bytes.size <= 262144) { "Response too large" }
            val response = String(bytes, StandardCharsets.UTF_8)
            if (status !in 200..299) throw parseError(response, status)
            return response
        } finally {
            connection.disconnect()
        }
    }

    private fun parseError(raw: String, status: Int): ProviderApiException = try {
        val error = FirstBatchContractBoundary.parseProductError(raw)
        ProviderApiException(error.code, localizedError(error.code), error.retryable)
    } catch (_: Exception) {
        ProviderApiException("HTTP_$status", "服务暂时不可用，请稍后重试。", status >= 500)
    }

    private fun localizedError(code: String): String = when (code) {
        "INVITATION_EXPIRED" -> "邀请已过期，请联系原邀请运营重新获取。"
        "INVITATION_EXHAUSTED" -> "邀请名额已用完，已有账号仍可登录。"
        "INVITATION_REVOKED" -> "邀请已撤销，请联系原邀请运营。"
        "PHONE_ALREADY_REGISTERED" -> "该手机号已有账号，请切换到手机号登录。"
        "PHONE_NOT_REGISTERED" -> "未找到该手机号对应的账号。"
        "PHONE_VERIFICATION_CODE_INVALID" -> "验证码不正确，请核对后重试。"
        "PHONE_VERIFICATION_EXPIRED", "PHONE_VERIFICATION_INVALID" -> "验证码已失效，请重新获取。"
        "PHONE_VERIFICATION_RATE_LIMITED" -> "请求过于频繁，请稍后再试。"
        "SMS_DELIVERY_UNAVAILABLE" -> "验证码服务暂时不可用，请稍后重试。"
        "PROVIDER_DISABLED" -> "账号当前不可用，请联系运营处理。"
        "AUTHENTICATION_REQUIRED" -> "登录状态已失效，请重新登录。"
        "AUTHORIZATION_DENIED" -> "当前管理身份无权操作这台执行手机。"
        "ASSOCIATION_SESSION_EXPIRED" -> "关联码已失效，请在执行手机上刷新后重试。"
        "ASSOCIATION_SESSION_CONSUMED" -> "该关联码已经完成或失效，请刷新设备列表。"
        "ASSOCIATION_TARGET_CHANGED" -> "关联目标已变化，请重新扫码核对。"
        "DEVICE_ALREADY_ASSOCIATED" -> "这台执行手机已经关联，无需重复操作。"
        "INSTALLATION_BOOTSTRAP_RATE_LIMITED" -> "设备接入请求过于频繁，请稍后重试。"
        else -> "操作未完成，请核对信息后重试。"
    }
}
