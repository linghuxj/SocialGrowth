package com.socialgrowth.product

import org.json.JSONObject
import java.util.UUID

class AssociationApiClient(private val http: ProviderApiClient) {
    fun bootstrap(credential: String, idempotencyKey: String): InstallationAuth =
        AssociationContractBoundary.parseInstallationAuth(
            http.post(
                "/api/installation/bootstrap",
                JSONObject()
                    .put("metadata", http.metadata(idempotencyKey))
                    .put("installationCredential", credential),
            ),
        )

    fun installationState(sessionToken: String): InstallationSelfView =
        FirstBatchContractBoundary.parseInstallationSelfView(
            http.post(
                "/api/installation/state",
                JSONObject().put("metadata", http.metadata("state-${UUID.randomUUID()}")),
                sessionToken,
            ),
        )

    fun createAssociationSession(
        sessionToken: String,
        deviceLabel: String,
        idempotencyKey: String,
    ): AssociationSession = AssociationContractBoundary.parseAssociationSession(
        http.post(
            "/api/installation/association-sessions",
            JSONObject()
                .put("metadata", http.metadata(idempotencyKey))
                .put("deviceLabel", deviceLabel),
            sessionToken,
        ),
    )

    fun inspect(
        providerToken: String,
        associationCode: String,
    ): AssociationInspection = AssociationContractBoundary.parseInspection(
        http.post(
            "/api/provider/association-sessions/inspect",
            JSONObject()
                .put("metadata", http.metadata("inspect-${UUID.randomUUID()}"))
                .put("associationCode", associationCode),
            providerToken,
        ),
    )

    fun confirm(
        providerToken: String,
        inspection: AssociationInspection,
        idempotencyKey: String,
    ): AssociationReceipt = AssociationContractBoundary.parseReceipt(
        http.post(
            "/api/provider/association-sessions/confirm",
            associationTarget(inspection, idempotencyKey),
            providerToken,
        ),
    )

    fun result(
        providerToken: String,
        inspection: AssociationInspection,
    ): AssociationReceipt? = AssociationContractBoundary.parseResult(
        http.post(
            "/api/provider/association-sessions/result",
            associationTarget(inspection, "result-${UUID.randomUUID()}"),
            providerToken,
        ),
    )

    fun devices(providerToken: String): List<ProviderDevice> =
        AssociationContractBoundary.parseDevices(
            http.post(
                "/api/provider/devices/list",
                JSONObject().put("metadata", http.metadata("devices-${UUID.randomUUID()}")),
                providerToken,
            ),
        )

    private fun associationTarget(
        inspection: AssociationInspection,
        idempotencyKey: String,
    ) = JSONObject()
        .put("metadata", http.metadata(idempotencyKey))
        .put("associationSessionId", inspection.associationSessionId.toString())
        .put("expectedInstallationId", inspection.installationId.toString())
}
