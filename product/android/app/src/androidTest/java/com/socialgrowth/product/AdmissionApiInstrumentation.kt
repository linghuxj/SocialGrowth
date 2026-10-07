package com.socialgrowth.product

import android.app.Activity
import android.app.Instrumentation
import android.os.Bundle
import org.json.JSONObject
import java.net.URL
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import android.util.Base64
import javax.net.ssl.HttpsURLConnection

// Supplemental real authenticated HTTPS protocol checks only, no UI/business
// acceptance. Uses the existing installation session in process; never emits
// identity/token/challenge bytes, bootstraps or changes participation/policy.
class AdmissionApiInstrumentation : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        val result=Bundle();var passed=0;var stage="installation_identity"
        fun checkpoint(value: String) {
            stage=value
            sendStatus(0,Bundle().apply { putString("failureStage",value) })
        }
        checkpoint(stage)
        try {
            val identity=InstallationIdentityStore(targetContext).load() ?: error("Missing identity")
            val token=identity.activeSessionToken() ?: error("Inactive identity")
            val installation=UUID.fromString(identity.installationId)
            val generation=requireNotNull(identity.generation).toString()
            val base="https://macbook-pro.tail3656e0.ts.net:9443"
            checkpoint("health_tls")
            val health=URL("$base/health").openConnection() as HttpsURLConnection
            try {
                health.connectTimeout=5000;health.readTimeout=5000;health.instanceFollowRedirects=false
                require(health.responseCode==200);passed++
                val bytes=health.inputStream.use { it.readNBytes(4097) };require(bytes.size<=4096)
                checkpoint("health_source")
                val body=JSONObject(String(bytes,Charsets.UTF_8))
                require(body.getBoolean("trustedIncomingTransport") && body.getBoolean("expectedPhoneSourceVerified"));passed++
                require(!body.getBoolean("networkAdmissionGranted") && !body.getBoolean("actionPermissionGranted"));passed++
            } finally { health.disconnect() }
            val client=NetworkAdmissionVerifierClient(base)
            checkpoint("authenticated_state")
            val state=client.state(token,installation,generation)
            require(!state.verifierReady && state.enrollment==null);passed++
            fun body()=JSONObject().put("protocolVersion",GeneratedAdmissionContractSpec.PROTOCOL_VERSION).put("requestId","native-admission-${UUID.randomUUID()}")
            fun rejected(code: String, action: () -> Unit) {
                var actual:String?=null
                try { action() } catch(error:AdmissionApiException) { actual=error.code }
                require(actual==code);passed++
            }
            checkpoint("closed_protocol_validation")
            rejected("INPUT_INVALID") { client.post("state",body().put("networkAdmissionGranted",true),token) }
            rejected("PROTOCOL_UNSUPPORTED") { client.post("state",body().put("protocolVersion","other"),token) }
            rejected("AUTHENTICATION_REQUIRED") { client.post("state",body(),"A".repeat(43)) }
            val generator=KeyPairGenerator.getInstance("EC");generator.initialize(ECGenParameterSpec("secp256r1"))
            val publicKey=Base64.encodeToString(generator.generateKeyPair().public.encoded,Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
            checkpoint("unavailable_verifier_begin")
            rejected("VERIFIER_UNAVAILABLE") { client.begin(token,installation,generation,publicKey,"native-begin-${UUID.randomUUID()}") }
            val request=body().put("enrollmentId",UUID.randomUUID().toString()).put("expectedVersion",0).put("requestKey","native-challenge-${UUID.randomUUID()}")
            checkpoint("unbound_challenge_proof")
            rejected("AUTHORITY_CHANGED") { client.post("challenge",request,token) }
            rejected("AUTHORITY_CHANGED") { client.post("proof",request.put("proof",JSONObject().put("challengeId",UUID.randomUUID().toString()).put("signature","A".repeat(86))),token) }
            checkpoint("state_readback")
            require(client.state(token,installation,generation)==state);passed++
            result.putInt("failed",0)
            result.putString("stream","Authenticated phone admission protocol: $passed supplemental checks passed; no business admission.\n")
        } catch(_:Exception) {
            result.putInt("failed",1);result.putString("failureStage",stage)
            result.putString("stream","Authenticated phone protocol check failed; private details suppressed.\n")
        }
        result.putInt("passed",passed);result.putBoolean("networkAdmissionGranted",false);result.putBoolean("actionPermissionGranted",false)
        result.putBoolean("noParticipationCommandIssued",true)
        finish(if(result.getInt("failed")==0) Activity.RESULT_OK else Activity.RESULT_CANCELED,result)
    }
}
