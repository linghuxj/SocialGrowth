// Generated from product/contracts/src/local-participation.ts; do not edit.
package com.socialgrowth.product

object GeneratedParticipationContractSpec {
    const val VERSION = "2026-10-02.participation-v1"
    val SCOPE_KEYS = setOf("deviceId", "associationId", "installationId", "installationGeneration", "deviceFactVersion", "controlGeneration")
    val CHALLENGE_KEYS = setOf("protocolVersion", "challengeId", "sequence", "runId", "scope", "issuedAt", "expiresAt")
    val RECEIPT_KEYS = setOf("protocolVersion", "receiptId", "scope", "runId", "sequence", "state", "checkedAt", "validUntil", "actionPermissionGranted", "stopConfirmed")
    val RUN_KEYS = setOf("protocolVersion", "runId", "scope", "startedAt", "actionPermissionGranted", "stopConfirmed")
}
