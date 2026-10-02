package com.socialgrowth.product

import org.json.JSONObject
import java.math.BigInteger
import java.time.Instant
import java.util.UUID

data class ParticipationScope(val deviceId: String, val associationId: String, val installationId: String,
    val installationGeneration: String, val deviceFactVersion: Long, val controlGeneration: String?)
data class ParticipationRun(val runId: String, val scope: ParticipationScope)
data class ParticipationChallenge(val runId: String, val challengeId: String, val scope: ParticipationScope, val sequence: String)

/** Independent participation boundary. Does not deserialize a phone permission. */
object ParticipationContractBoundary {
    private fun strict(json: JSONObject, keys: Set<String>) { require(json.keys().asSequence().toSet() == keys) }
    private fun string(json: JSONObject, key: String): String = (json.get(key) as? String) ?: error("Invalid participation string")
    private fun uuid(json: JSONObject, key: String): String = string(json, key).also {
        require(it.matches(Regex(GeneratedFirstBatchContractSpec.UUID_PATTERN))); UUID.fromString(it)
    }
    private fun generation(json: JSONObject, key: String): String = string(json, key).also {
        require(it.matches(Regex("^[1-9][0-9]{0,18}$"))); require(BigInteger(it).signum() > 0)
    }
    private fun time(json: JSONObject, key: String): Instant = string(json, key).let {
        require(it.matches(Regex(GeneratedFirstBatchContractSpec.TIMESTAMP_PATTERN))); Instant.parse(it)
    }
    private fun scope(json: JSONObject): ParticipationScope {
        strict(json, GeneratedParticipationContractSpec.SCOPE_KEYS)
        val fact = json.get("deviceFactVersion")
        require(fact is Number && fact.toString().matches(Regex("^[0-9]+$")))
        val exact = BigInteger(fact.toString()); require(exact in BigInteger.ZERO..BigInteger("9007199254740991"))
        val version = exact.toLong()
        return ParticipationScope(uuid(json,"deviceId"),uuid(json,"associationId"),uuid(json,"installationId"),
            generation(json,"installationGeneration"),version,if(json.isNull("controlGeneration")) null else generation(json,"controlGeneration"))
    }
    private fun base(json: JSONObject) { require(string(json,"protocolVersion") == GeneratedParticipationContractSpec.VERSION) }
    private fun noPermission(json: JSONObject) {
        require(json.get("actionPermissionGranted") == false && json.get("stopConfirmed") == false)
    }
    fun run(raw: String): ParticipationRun {
        val json=JSONObject(raw); strict(json,GeneratedParticipationContractSpec.RUN_KEYS);base(json);noPermission(json);time(json,"startedAt")
        return ParticipationRun(uuid(json,"runId"),scope(json.getJSONObject("scope")))
    }
    fun challenge(raw: String): ParticipationChallenge {
        val json=JSONObject(raw);strict(json,GeneratedParticipationContractSpec.CHALLENGE_KEYS);base(json)
        require(time(json,"expiresAt").toEpochMilli()-time(json,"issuedAt").toEpochMilli()==6_000L)
        return ParticipationChallenge(uuid(json,"runId"),uuid(json,"challengeId"),scope(json.getJSONObject("scope")),generation(json,"sequence"))
    }
    fun receipt(raw: String, runId: String, expectedScope: ParticipationScope?, sequence: String?, withdrawn: Boolean) {
        val json=JSONObject(raw);strict(json,GeneratedParticipationContractSpec.RECEIPT_KEYS);base(json);noPermission(json);uuid(json,"receiptId")
        require(uuid(json,"runId")==runId)
        val currentScope=scope(json.getJSONObject("scope")); if(expectedScope!=null) require(currentScope==expectedScope)
        val seq=generation(json,"sequence"); if(sequence!=null) require(seq==sequence)
        require(string(json,"state")==if(withdrawn) "withdrawn" else "active")
        val span=time(json,"validUntil").toEpochMilli()-time(json,"checkedAt").toEpochMilli()
        require(span==if(withdrawn) 0L else 10_000L)
    }
}

class ParticipationApiClient(private val http: ProviderApiClient) {
    private fun body(runId: String,key: String)=JSONObject().put("protocolVersion",GeneratedParticipationContractSpec.VERSION)
        .put("runId",runId).put("requestId","android-participation-${UUID.randomUUID()}").put("requestKey",key)
    fun start(token: String,runId: String): ParticipationRun = ParticipationContractBoundary.run(
        http.post("/api/installation/participation/start",body(runId,"start-$runId"),token))
    fun challenge(token: String,runId: String): ParticipationChallenge = ParticipationContractBoundary.challenge(
        http.post("/api/installation/participation/challenge",body(runId,"pulse-${UUID.randomUUID()}"),token))
    fun confirm(token: String,challenge: ParticipationChallenge) {
        val raw=http.post("/api/installation/participation/confirm",body(challenge.runId,"confirm-${challenge.challengeId}")
            .put("challengeId",challenge.challengeId),token)
        ParticipationContractBoundary.receipt(raw,challenge.runId,challenge.scope,challenge.sequence,false)
    }
    fun withdraw(token: String,runId: String) {
        val raw=http.post("/api/installation/participation/withdraw",body(runId,"withdraw-$runId"),token)
        ParticipationContractBoundary.receipt(raw,runId,null,null,true)
    }
}
