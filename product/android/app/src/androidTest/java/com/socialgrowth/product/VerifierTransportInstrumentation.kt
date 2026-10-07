package com.socialgrowth.product

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import org.json.JSONObject
import java.net.URL
import javax.net.ssl.HttpsURLConnection

// Supplemental live HTTPS/source check only. No UI, token, key, enrollment,
// participation, pairing, port reporting, media app or policy mutation.
class VerifierTransportInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        val result = Bundle()
        var passed = 0
        try {
            val connection = URL("https://macbook-pro.tail3656e0.ts.net:9443/health").openConnection() as HttpsURLConnection
            try {
                connection.connectTimeout = 10_000
                connection.readTimeout = 10_000
                connection.instanceFollowRedirects = false
                connection.requestMethod = "GET"
                // Use the installed debug application's actual trust/hostname
                // checks. Never replace socket factory or HostnameVerifier.
                require(connection.responseCode == 200); passed++
                val body = connection.inputStream.use { stream ->
                    val bytes = stream.readNBytes(4097)
                    require(bytes.size <= 4096)
                    JSONObject(String(bytes, Charsets.UTF_8))
                }
                require(body.getString("code") == "INDEPENDENT_VERIFIER_TRANSPORT_PREFLIGHT")
                require(body.getBoolean("trustedIncomingTransport")); passed++
                require(body.getBoolean("sourceIdentityVerified")); passed++
                require(body.getBoolean("expectedPhoneSourceVerified")); passed++
                for (field in listOf("restrictionVerified", "networkRevisionAvailable", "enrollmentApiReady", "networkAdmissionGranted", "actionPermissionGranted")) {
                    require(!body.getBoolean(field)); passed++
                }
                result.putBoolean("actualPhoneIncomingSourceVerified", true)
            } finally { connection.disconnect() }
            result.putInt("passed", passed); result.putInt("failed", 0)
            result.putString("stream", "Phone verifier TLS/source: $passed supplemental checks passed; no formal admission or business acceptance.\n")
        } catch (error: Exception) {
            result.putInt("passed", passed); result.putInt("failed", 1)
            result.putBoolean("actualPhoneIncomingSourceVerified", false)
            val category = error.javaClass.simpleName
            result.putString("failureCategory", if (category in setOf("UnknownHostException", "SSLHandshakeException", "SocketTimeoutException", "ConnectException")) category else "transport_check_failed")
            result.putString("stream", "Phone verifier transport failed; platform details suppressed.\n")
        }
        result.putBoolean("networkAdmissionGranted", false)
        result.putBoolean("actionPermissionGranted", false)
        finish(if (result.getInt("failed") == 0) Activity.RESULT_OK else Activity.RESULT_CANCELED, result)
    }
}
