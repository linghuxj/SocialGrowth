package com.socialgrowth.product
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails
import org.json.JSONObject

class ParticipationContractBoundaryTest {
    private val id="12345678-1234-4234-8234-123456789012"
    private fun scope()=JSONObject().put("deviceId",id).put("associationId",id).put("installationId",id)
        .put("installationGeneration","9999999999999999999").put("deviceFactVersion",0).put("controlGeneration","9007199254740993")
    private fun challenge()=JSONObject().put("protocolVersion",GeneratedParticipationContractSpec.VERSION).put("runId",id).put("challengeId",id)
        .put("sequence","9007199254740993").put("scope",scope()).put("issuedAt","2026-10-02T00:00:00.000Z").put("expiresAt","2026-10-02T00:00:06.000Z")
    @Test fun preservesLosslessGeneration(){val c=ParticipationContractBoundary.challenge(challenge().toString());assertEquals("9007199254740993",c.sequence);assertEquals("9999999999999999999",c.scope.installationGeneration)}
    @Test fun rejectsUnexpectedKeysAndInvalidNonceLifetime(){assertFails{ParticipationContractBoundary.challenge(challenge().put("actionPermissionGranted",true).toString())};assertFails{ParticipationContractBoundary.challenge(challenge().put("expiresAt","2026-10-02T00:00:07.000Z").toString())};assertFails{ParticipationContractBoundary.challenge(challenge().put("scope",scope().put("deviceFactVersion",0.5)).toString())}}
    @Test fun receiptIsNotActionPermissionOrStopEvidence(){val c=ParticipationContractBoundary.challenge(challenge().toString());val r=JSONObject().put("protocolVersion",GeneratedParticipationContractSpec.VERSION).put("runId",id).put("receiptId",id).put("sequence",c.sequence).put("scope",scope()).put("state","active").put("checkedAt","2026-10-02T00:00:00.000Z").put("validUntil","2026-10-02T00:00:10.000Z").put("actionPermissionGranted",false).put("stopConfirmed",false)
        ParticipationContractBoundary.receipt(r.toString(),id,c.scope,c.sequence,false)
        assertFails{ParticipationContractBoundary.receipt(JSONObject(r.toString()).put("stopConfirmed",true).toString(),id,c.scope,c.sequence,false)}
        assertFails{ParticipationContractBoundary.receipt(JSONObject(r.toString()).put("sequence","2").toString(),id,c.scope,c.sequence,false)}
        assertFails{ParticipationContractBoundary.receipt(JSONObject(r.toString()).put("validUntil","2026-10-02T00:00:11.000Z").toString(),id,c.scope,c.sequence,false)}
    }
}
