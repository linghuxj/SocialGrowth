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
        deviceLabel: String? = null,
    ): AssociationReceipt = AssociationContractBoundary.parseReceipt(
        http.post(
            "/api/provider/association-sessions/confirm",
            associationTarget(inspection, idempotencyKey).apply {
                deviceLabel?.trim()?.takeIf(String::isNotEmpty)?.let { put("deviceLabel", it) }
            },
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

    internal fun renameDevice(
        providerToken: String,
        device: ProviderDevice,
        command: ProviderDeviceLabelCommand,
    ): ProviderDevice {
        require(command.deviceId == device.deviceId)
        val normalized = command.displayName
        require(normalized.trim() == normalized && normalized.length in 1..100)
        val body = JSONObject()
            .put("metadata", JSONObject()
                .put("contractVersion", command.contractVersion)
                .put("requestId", command.requestId)
                .put("idempotencyKey", command.idempotencyKey))
            .put("expectedFactVersion", command.expectedFactVersion)
            .put("displayName", normalized)
        return AssociationContractBoundary.parseRenamedDevice(
            http.post("/api/provider/devices/${device.deviceId}/label", body, providerToken),
        ).also { require(it.deviceId == device.deviceId && it.factVersion == command.expectedFactVersion + 1L) }
    }

    private fun associationTarget(
        inspection: AssociationInspection,
        idempotencyKey: String,
    ) = JSONObject()
        .put("metadata", http.metadata(idempotencyKey))
        .put("associationSessionId", inspection.associationSessionId.toString())
        .put("expectedInstallationId", inspection.installationId.toString())
}
