package com.socialgrowth.product

import org.json.JSONObject
import java.time.Instant
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class AdmissionApiBoundaryTest {
    private val id=UUID.fromString("018f47ac-7a69-7db4-a572-8c62f3650191")
    private fun state()=JSONObject().put("protocolVersion",GeneratedAdmissionContractSpec.PROTOCOL_VERSION)
        .put("scope",JSONObject().put("deviceId",id.toString()).put("installationId",id.toString())
            .put("installationGeneration","9007199254740993").put("ownershipVersion","1"))
        .put("enrollment",JSONObject().put("enrollmentId",id.toString()).put("enrollmentGeneration","1")
            .put("version",2).put("phase","restricted").put("expiresAt","2026-10-03T10:10:00Z"))
        .put("verifierReady",true).put("networkAdmissionGranted",false).put("actionPermissionGranted",false)
    @Test fun refusesScopeAuthorityAndVersionCoercion() {
        val raw=state();assertEquals("9007199254740993",AdmissionApiBoundary.snapshot(raw.toString(),id,"9007199254740993").scope.installationGeneration)
        for (bad in listOf(state().put("actionPermissionGranted",true),state().put("verifierReady","true"),state().put("extra",1),
            state().put("enrollment",state().getJSONObject("enrollment").put("version",2.1))))
            assertFailsWith<ContractBoundaryException> { AdmissionApiBoundary.snapshot(bad.toString(),id,"9007199254740993") }
        assertFailsWith<ContractBoundaryException> { AdmissionApiBoundary.snapshot(raw.toString(),UUID.randomUUID(),"9007199254740993") }
        assertFailsWith<ContractBoundaryException> { AdmissionApiBoundary.snapshot(raw.toString(),id,"1") }
    }
    private fun challenge(): JSONObject = JSONObject().put("protocolVersion",GeneratedAdmissionContractSpec.PROTOCOL_VERSION)
        .put("purpose","network_node_binding").put("challengeId",id.toString()).put("enrollmentId",id.toString())
        .put("deviceId",id.toString()).put("installationId",id.toString()).put("installationGeneration","9007199254740993")
        .put("enrollmentGeneration","1").put("nonce","A".repeat(43)).put("issuedAt","2026-10-03T10:00:00Z").put("expiresAt","2026-10-03T10:01:00Z")
        .put("node",JSONObject().put("nodeId","node-A").put("nodeKey","key-A").put("networkRevision",1))
    @Test fun validatesChallengeAgainstExpectedScopeAndCurrentEnrollment() {
        val expected=AdmissionApiBoundary.snapshot(state().toString(),id,"9007199254740993")
        val now=Instant.parse("2026-10-03T10:00:10Z")
        val good=state().put("challenge",challenge())
        assertEquals(id,AdmissionApiBoundary.challenge(good.toString(),expected,now).challenge.challengeId)
        val wrong=state().put("challenge",challenge().put("deviceId",UUID.randomUUID().toString()))
        assertFailsWith<ContractBoundaryException> { AdmissionApiBoundary.challenge(wrong.toString(),expected,now) }
        val overrun=state().put("challenge",challenge().put("expiresAt","2026-10-03T10:11:00Z"))
        assertFailsWith<ContractBoundaryException> { AdmissionApiBoundary.challenge(overrun.toString(),expected,now) }
        assertFailsWith<ContractBoundaryException> { AdmissionApiBoundary.challenge(good.toString(),expected,Instant.parse("2026-10-03T10:01:00Z")) }
    }
    @Test fun rejectsErrorDriftAndKeepsDetailsOutOfException() {
        val error=JSONObject().put("protocolVersion",GeneratedAdmissionContractSpec.PROTOCOL_VERSION).put("requestId","request_1234")
            .put("error",JSONObject().put("code","VERIFIER_UNAVAILABLE").put("retryable",true))
        assertEquals("VERIFIER_UNAVAILABLE",AdmissionApiBoundary.failure(error.toString()).code)
        error.getJSONObject("error").put("token","private")
        val rejected=assertFailsWith<ContractBoundaryException> { AdmissionApiBoundary.failure(error.toString()) }
        assertEquals(null,rejected.cause)
    }
    @Test fun refusesNonHttpsAndCredentialOrPathBearingOrigins() {
        for (url in listOf("http://127.0.0.1:4320","https://user:secret@example.com","https://example.com/path","https://example.com?secret=1","https://example.com#part"))
            assertFailsWith<IllegalArgumentException> { NetworkAdmissionVerifierClient(url) }
    }
}
