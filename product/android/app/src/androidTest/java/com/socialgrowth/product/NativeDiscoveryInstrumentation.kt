package com.socialgrowth.product

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import android.os.Build
import android.os.SystemClock

// Supplemental actual platform/lifecycle observation only. Does not launch UI,
// read sessions/keys, report to a backend, pair/connect, or control a media app.
class NativeDiscoveryInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        val result = Bundle()
        if (Build.VERSION.SDK_INT < 34) {
            result.putString("nativeObservation", "blocked_unsupported_api")
            result.putInt("passed", 0); result.putInt("failed", 0)
            finish(Activity.RESULT_OK, result); return
        }
        var discovery: NativeEndpointDiscovery? = null
        var checks = 0
        fun check(value: Boolean) { require(value); checks++ }
        try {
            if (BuildConfig.ENDPOINT_DIAGNOSTICS) {
                try {
                    val connection = java.net.URL(BuildConfig.API_BASE_URL).openConnection() as java.net.HttpURLConnection
                    try {
                        connection.connectTimeout = 10_000; connection.readTimeout = 10_000
                        connection.instanceFollowRedirects = false
                        result.putInt("diagnosticHttpsStatus", connection.responseCode)
                        check(connection.responseCode == 403) // Auth denied, TLS transport reachable; no business call.
                    } finally { connection.disconnect() }
                    try {
                        ProviderApiClient(BuildConfig.API_BASE_URL).post("/", org.json.JSONObject())
                        error("Unauthenticated transport probe must be denied")
                    } catch (e: ProviderApiException) { check(e.code == "HTTP_403") }
                } catch (e: Exception) {
                    result.putString("diagnosticNetworkFailure", e.javaClass.simpleName.takeIf { it in setOf("UnknownHostException", "SSLHandshakeException", "SocketTimeoutException", "ConnectException") } ?: "network_unavailable")
                    throw e
                }
            }
            runOnMainSync { discovery = NativeEndpointDiscovery(targetContext); discovery!!.start() }
            val started = discovery!!.snapshot()
            check(started.generation != null)
            SystemClock.sleep(if (started.active) 15_000 else 500)
            val observed = discovery!!.snapshot()
            result.putString("nativeObservation", if (observed.active) "observed_not_business_verified" else "blocked")
            result.putString("connectStatus", observed.connect.status.name)
            result.putString("pairingStatus", observed.pairing.status.name)
            observed.connect.port?.let { result.putInt("connectCandidatePort", it) }
            observed.pairing.port?.let { result.putInt("pairingCandidatePort", it) }
            result.putString("observationIssues", observed.issues.sorted().joinToString(","))
            runOnMainSync { discovery!!.close() }
            check(!discovery!!.snapshot().active)
            check(discovery!!.snapshot().connect.port == null && discovery!!.snapshot().pairing.port == null)
            SystemClock.sleep(1_500)
            check(!discovery!!.snapshot().active && discovery!!.snapshot().connect.port == null && discovery!!.snapshot().pairing.port == null)
            runOnMainSync { discovery!!.start(1_000) }
            val next = discovery!!.snapshot()
            check(next.generation != started.generation)
            SystemClock.sleep(2_000)
            check(!discovery!!.snapshot().active && discovery!!.snapshot().connect.port == null && discovery!!.snapshot().pairing.port == null)
            result.putString("finalIssues", discovery!!.snapshot().issues.sorted().joinToString(","))
            result.putInt("passed", checks); result.putInt("failed", 0)
            result.putString("stream", "Native discovery lifecycle: $checks checks passed. Candidate/unknown observations do not prove pairing, current trust, absence, or business readiness.\n")
        } catch (_: Exception) {
            result.putInt("passed", checks); result.putInt("failed", 1)
            result.putString("stream", "Native discovery check failed; platform causes suppressed.\n")
        } finally { runOnMainSync { discovery?.close() } }
        finish(if (result.getInt("failed") == 0) Activity.RESULT_OK else Activity.RESULT_CANCELED, result)
    }
}
