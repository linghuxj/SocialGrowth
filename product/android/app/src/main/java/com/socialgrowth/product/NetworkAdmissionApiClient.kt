package com.socialgrowth.product

import org.json.JSONObject
import java.math.BigDecimal
import java.net.URL
import java.time.Instant
import java.util.UUID
import javax.net.ssl.HttpsURLConnection

internal data class AdmissionScope(val deviceId: UUID, val installationId: UUID, val installationGeneration: String, val ownershipVersion: String)
internal data class AdmissionEnrollment(val enrollmentId: UUID, val generation: String, val version: Long, val phase: String, val expiresAt: String)
internal data class AdmissionSnapshot(val scope: AdmissionScope, val enrollment: AdmissionEnrollment?, val verifierReady: Boolean)
internal data class AdmissionChallengeResponse(val state: AdmissionSnapshot, val challenge: EnrollmentChallenge, val rawChallenge: String)
internal class AdmissionApiException(val code: String, val retryable: Boolean) : Exception("Network verification request rejected")

internal object AdmissionApiBoundary {
    private fun exact(json: JSONObject, keys: Set<String>) { require(json.keys().asSequence().toSet() == keys) }
    private fun string(json: JSONObject, key: String) = (json.get(key) as? String) ?: error("Invalid string")
    private fun uuid(json: JSONObject, key: String) = string(json,key).let {
        require(it.matches(Regex(GeneratedAdmissionContractSpec.UUID_PATTERN))); UUID.fromString(it)
    }
    private fun generation(json: JSONObject, key: String) = string(json,key).also {
        require(it.matches(Regex(GeneratedAdmissionContractSpec.GENERATION_PATTERN)))
    }
    private fun version(json: JSONObject, key: String): Long {
        val value=json.get(key); require(value is Number)
        return BigDecimal(value.toString()).longValueExact().also { require(it in 0..9007199254740991L) }
    }
    private fun parseSnapshot(json: JSONObject, expectedInstallation: UUID, expectedGeneration: String): AdmissionSnapshot {
        require(string(json,"protocolVersion")==GeneratedAdmissionContractSpec.PROTOCOL_VERSION)
        require(json.get("networkAdmissionGranted")==false && json.get("actionPermissionGranted")==false)
        val ready=json.get("verifierReady"); require(ready is Boolean)
        val scope=json.getJSONObject("scope"); exact(scope,GeneratedAdmissionApiSpec.SCOPE_KEYS)
        val current=AdmissionScope(uuid(scope,"deviceId"),uuid(scope,"installationId"),generation(scope,"installationGeneration"),generation(scope,"ownershipVersion"))
        require(current.installationId==expectedInstallation && current.installationGeneration==expectedGeneration)
        val enrollment=if(json.isNull("enrollment")) null else json.getJSONObject("enrollment").let {
            exact(it,GeneratedAdmissionApiSpec.ENROLLMENT_KEYS)
            val phase=string(it,"phase"); require(phase in GeneratedAdmissionApiSpec.PHASES)
            val expires=string(it,"expiresAt"); AdmissionContractBoundary.timestamp(expires)
            AdmissionEnrollment(uuid(it,"enrollmentId"),generation(it,"enrollmentGeneration"),version(it,"version"),phase,expires)
        }
        return AdmissionSnapshot(current,enrollment,ready)
    }
    fun snapshot(raw: String, installation: UUID, generation: String): AdmissionSnapshot = try {
        val json=JSONObject(raw); exact(json,GeneratedAdmissionApiSpec.SNAPSHOT_KEYS); parseSnapshot(json,installation,generation)
    } catch (_: Exception) { throw ContractBoundaryException("Invalid network verification state") }
    fun challenge(raw: String, expected: AdmissionSnapshot, now: Instant = Instant.now()): AdmissionChallengeResponse = try {
        val json=JSONObject(raw); exact(json,GeneratedAdmissionApiSpec.CHALLENGE_RESPONSE_KEYS)
        val state=parseSnapshot(json,expected.scope.installationId,expected.scope.installationGeneration)
        require(state.scope==expected.scope && state.verifierReady)
        val current=state.enrollment ?: error("Missing enrollment")
        val previous=expected.enrollment ?: error("Missing expected enrollment")
        require(current.enrollmentId==previous.enrollmentId && current.generation==previous.generation && current.phase=="restricted")
        require(current.version>=previous.version)
        val rawChallenge=json.getJSONObject("challenge").toString()
        val c=AdmissionContractBoundary.parse(rawChallenge)
        c.checkScope(EnrollmentSigningContext(current.enrollmentId,state.scope.deviceId,state.scope.installationId,
            state.scope.installationGeneration,current.generation),now)
        require(AdmissionContractBoundary.timestamp(c.expiresAt)<=AdmissionContractBoundary.timestamp(current.expiresAt))
        AdmissionChallengeResponse(state,c,rawChallenge)
    } catch (_: Exception) { throw ContractBoundaryException("Invalid network verification response") }
    fun failure(raw: String): AdmissionApiException = try {
        val json=JSONObject(raw);exact(json,GeneratedAdmissionApiSpec.ERROR_KEYS)
        require(string(json,"protocolVersion")==GeneratedAdmissionContractSpec.PROTOCOL_VERSION)
        require(string(json,"requestId").matches(Regex("^[A-Za-z0-9_-]{8,128}$")))
        val error=json.getJSONObject("error"); exact(error,GeneratedAdmissionApiSpec.ERROR_DETAIL_KEYS)
        val code=string(error,"code");require(code in GeneratedAdmissionApiSpec.ERROR_CODES)
        val retryable=error.get("retryable");require(retryable is Boolean)
        AdmissionApiException(code,retryable)
    } catch (_: Exception) { throw ContractBoundaryException("Invalid network verification error") }
}

/** Only an explicit independent HTTPS origin can send the installation token.
 * No redirects, alternate trust/hostname checks, or revision/body fallback. */
internal class NetworkAdmissionVerifierClient(baseUrl: String) {
    private val base=URL(baseUrl).also {
        require(it.protocol=="https" && it.userInfo==null && it.query==null && it.ref==null && it.path in setOf("", "/"))
        require(it.host.isNotBlank())
    }.toString().trimEnd('/')
    private fun body()=JSONObject().put("protocolVersion",GeneratedAdmissionContractSpec.PROTOCOL_VERSION)
        .put("requestId","android-admission-${UUID.randomUUID()}")
    private fun key(value: String): String = value.also { require(it.matches(Regex("^[A-Za-z0-9_-]{16,128}$"))) }
    internal fun post(route: String, body: JSONObject, token: String): String {
        require(route in setOf("state","begin","challenge","proof"))
        require(token.matches(Regex("^[A-Za-z0-9_-]{43}$")))
        val connection=URL("$base/api/installation/network-admission/$route").openConnection() as HttpsURLConnection
        try {
            connection.requestMethod="POST";connection.instanceFollowRedirects=false
            connection.connectTimeout=5000;connection.readTimeout=5000;connection.doOutput=true
            connection.setRequestProperty("Content-Type","application/json; charset=utf-8")
            connection.setRequestProperty("Authorization","Bearer $token")
            connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status=connection.responseCode
            val stream=if(status==200) connection.inputStream else connection.errorStream
            val bytes=stream?.use { it.readNBytes(16385) } ?: error("Missing response")
            require(bytes.size<=16384)
            val raw=String(bytes,Charsets.UTF_8)
            if(status!=200) throw AdmissionApiBoundary.failure(raw)
            return raw
        } catch(error: AdmissionApiException) { throw error }
        catch(_: Exception) { throw IllegalStateException("Network verification transport unavailable") }
        finally { connection.disconnect() }
    }
    fun state(token: String, installation: UUID, generation: String)=AdmissionApiBoundary.snapshot(post("state",body(),token),installation,generation)
    fun begin(token: String, installation: UUID, generation: String, publicKey: String, requestKey: String)=AdmissionApiBoundary.snapshot(
        post("begin",body().put("publicKeySpki",publicKey).put("requestKey",key(requestKey)),token),installation,generation)
    fun challenge(token: String, expected: AdmissionSnapshot, requestKey: String): AdmissionChallengeResponse {
        val enrollment=expected.enrollment ?: error("Missing enrollment")
        return AdmissionApiBoundary.challenge(post("challenge",body().put("enrollmentId",enrollment.enrollmentId.toString())
            .put("expectedVersion",enrollment.version).put("requestKey",key(requestKey)),token),expected)
    }
    // The caller retains this exact signed payload and key across response loss.
    // Retrying must not sign again (ECDSA signatures are intentionally random).
    fun proof(token: String, expected: AdmissionChallengeResponse, signature: String, requestKey: String): AdmissionSnapshot {
        require(signature.matches(Regex("^[A-Za-z0-9_-]{86}$")))
        val current=expected.state.enrollment ?: error("Missing enrollment")
        val raw=post("proof",body().put("enrollmentId",current.enrollmentId.toString()).put("expectedVersion",current.version)
            .put("requestKey",key(requestKey)).put("proof",JSONObject().put("challengeId",expected.challenge.wireIds[0]).put("signature",signature)),token)
        return AdmissionApiBoundary.snapshot(raw,expected.state.scope.installationId,expected.state.scope.installationGeneration).also {
            require(it.scope==expected.state.scope && it.enrollment?.enrollmentId==current.enrollmentId && it.enrollment.generation==current.generation)
            require(it.enrollment.version>=current.version)
        }
    }
}

/** Existing business connection may read facts; it cannot send begin/proof. */
internal class NetworkAdmissionStateClient(private val http: ProviderApiClient) {
    fun state(token: String, installation: UUID, generation: String)=AdmissionApiBoundary.snapshot(http.post(
        "/api/installation/network-admission/state",JSONObject().put("protocolVersion",GeneratedAdmissionContractSpec.PROTOCOL_VERSION)
            .put("requestId","android-admission-state-${UUID.randomUUID()}"),token),installation,generation)
}
