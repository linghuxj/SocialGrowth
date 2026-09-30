package com.socialgrowth.product

import org.json.JSONObject
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class AdmissionContractBoundaryTest {
    private val id = "018F47AC-7A69-7DB4-A572-8C62F3650191"
    private fun fixture(): JSONObject = JSONObject()
        .put("protocolVersion", "2026-09-30.admission-v1").put("purpose", "network_node_binding")
        .put("challengeId", id).put("enrollmentId", id).put("deviceId", id).put("installationId", id)
        .put("installationGeneration", "9007199254740993").put("enrollmentGeneration", "1")
        .put("node", JSONObject().put("nodeId", "node-A").put("nodeKey", "key-A").put("networkRevision", 1))
        .put("nonce", "A".repeat(43)).put("issuedAt", "2026-09-30T10:00:00.0000000001Z").put("expiresAt", "2026-09-30T10:01:00Z")

    @Test
    fun strictlyConsumesIndependentVersionAndLosslessGenerations() {
        val challenge = AdmissionContractBoundary.parse(fixture().toString())
        assertEquals("9007199254740993", challenge.context.installationGeneration)
        assertEquals(1L, challenge.node.networkRevision)
        val invalid = listOf(
            fixture().put("protocolVersion", "wrong"), fixture().put("purpose", "adb_pairing"),
            fixture().put("installationGeneration", 1), fixture().put("enrollmentGeneration", "0"),
            fixture().put("clientNodeId", "node-A"), fixture().put("nonce", "short"),
            fixture().put("expiresAt", "2026-09-30T10:00:00.0000000001Z"),
            fixture().put("node", fixture().getJSONObject("node").put("networkRevision", "1")),
            fixture().put("node", fixture().getJSONObject("node").put("otherDevice", "hidden")),
        )
        invalid.forEach {
            val failure = assertFailsWith<ContractBoundaryException> { AdmissionContractBoundary.parse(it.toString()) }
            assertEquals(null, failure.cause)
            assertEquals("Invalid network admission challenge", failure.message)
        }
    }

    @Test
    fun rejectsWrongScopeAndTimeWithoutRoundingChallengeFractions() {
        val challenge = AdmissionContractBoundary.parse(fixture().toString())
        val current = Instant.parse("2026-09-30T10:00:01Z")
        challenge.checkScope(challenge.context, current)
        assertFailsWith<IllegalArgumentException> { challenge.checkScope(challenge.context.copy(enrollmentGeneration = "2"), current) }
        assertFailsWith<IllegalArgumentException> { challenge.checkScope(challenge.context.copy(installationGeneration = "2"), current) }
        assertFailsWith<IllegalArgumentException> { challenge.checkScope(challenge.context, Instant.parse("2026-09-30T10:00:00Z")) }
        assertFailsWith<IllegalArgumentException> { challenge.checkScope(challenge.context, Instant.parse("2026-09-30T10:01:00Z")) }
        assertEquals(0, AdmissionContractBoundary.timestamp("2026-09-30T10:00:00+19:00").compareTo(AdmissionContractBoundary.timestamp("2026-09-29T15:00:00Z")))
    }

    @Test
    fun canonicalTupleMatchesNodeJsonStringifyIncludingOriginalUuidSpelling() {
        val challenge = AdmissionContractBoundary.parse(fixture().toString())
        val expected = """["2026-09-30.admission-v1","network_node_binding","$id","$id","$id","$id","9007199254740993","1","node-A","key-A",1,"${"A".repeat(43)}","2026-09-30T10:00:00.0000000001Z","2026-09-30T10:01:00Z"]"""
        assertContentEquals(expected.toByteArray(Charsets.UTF_8), challenge.signingBytes())
        // JSON.stringify preserves '/', U+2028 and paired surrogates, but escapes
        // lone surrogates instead of letting UTF-8 replace them silently.
        assertEquals("\"</script>/\u2028😀\\ud800\\n\\\"\\\\\"", AdmissionContractBoundary.quote("</script>/\u2028😀\ud800\n\"\\"))
        val hash = MessageDigest.getInstance("SHA-256").digest(challenge.signingBytes())
        assertEquals("f9ae23f75612797357faae891c2af105a509d6c222dd1781774748e7b2574387", hash.joinToString("") { "%02x".format(it.toInt() and 0xff) })
    }

    @Test
    fun convertsRealDerSignaturesToTheFixedP1363FormatAcceptedByAnIndependentVerifier() {
        val generator = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }
        val key = generator.generateKeyPair()
        P256SignatureEncoding.requireP256(key.public)
        assertFailsWith<IllegalArgumentException> {
            P256SignatureEncoding.requireP256(KeyPairGenerator.getInstance("EC").apply {
                initialize(ECGenParameterSpec("secp384r1"))
            }.generateKeyPair().public)
        }
        val bytes = AdmissionContractBoundary.parse(fixture().toString()).signingBytes()
        repeat(40) {
            val der = Signature.getInstance("SHA256withECDSA").run { initSign(key.private); update(bytes); sign() }
            val raw = P256SignatureEncoding.derToP1363(der)
            assertEquals(64, raw.size)
            assertTrue(Signature.getInstance("SHA256withECDSAinP1363Format").run { initVerify(key.public); update(bytes); verify(raw) })
        }
        for (invalid in listOf(byteArrayOf(), byteArrayOf(0x30, 0x00),
            byteArrayOf(0x30, 0x06, 0x02, 0x01, 0x80.toByte(), 0x02, 0x01, 0x01),
            byteArrayOf(0x30, 0x07, 0x02, 0x02, 0x00, 0x01, 0x02, 0x01, 0x01))) {
            assertFailsWith<IllegalArgumentException> { P256SignatureEncoding.derToP1363(invalid) }
        }
    }
}
