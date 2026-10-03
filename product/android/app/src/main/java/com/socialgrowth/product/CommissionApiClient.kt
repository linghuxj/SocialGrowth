package com.socialgrowth.product

import org.json.JSONObject
import java.math.BigInteger
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant
import java.util.UUID

internal data class CommissionCursor(val incomeId: UUID, val revision: Int)
internal data class ProviderCommissionRecord(
    val incomeId: UUID,
    val revision: Int,
    val currentForIncome: Boolean,
    val accountIdentityRef: String,
    val platform: String,
    val currency: String,
    val minorUnitScale: Int,
    val productionStartsAt: Instant,
    val productionEndsAt: Instant,
    val receivedAt: Instant,
    val evaluatedAt: Instant,
    val receivedRevenueMinorUnits: String,
    val commissionMinorUnits: String,
    val appliedFraction: String,
    val rateVersion: Int,
    val rounding: String,
    val moneyPolicyVersion: Int,
    val calculationStage: String,
    val paymentStatus: String,
    val paymentAllowed: Boolean,
)
internal data class ProviderCommissionPage(val records: List<ProviderCommissionRecord>, val nextAfter: CommissionCursor?)

internal class CommissionApiClient(baseUrl: String) {
    private val base = URL(baseUrl).also {
        require(it.protocol in setOf("http", "https") && it.userInfo == null && it.query == null && it.ref == null)
        require(it.host.isNotBlank() && it.path in setOf("", "/"))
    }.toString().trimEnd('/')

    fun list(token: String, after: CommissionCursor? = null, pageSize: Int = 20): ProviderCommissionPage {
        require(token.matches(Regex("^[A-Za-z0-9_-]{43}$")) && pageSize in 1..50)
        val query = buildList {
            add("pageSize=$pageSize")
            after?.let {
                add("afterIncomeId=${URLEncoder.encode(it.incomeId.toString(), Charsets.UTF_8.name())}")
                add("afterRevision=${it.revision}")
            }
        }.joinToString("&")
        val connection = URL("$base/api/provider/commissions?$query").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "GET"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 8_000
            connection.readTimeout = 10_000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $token")
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { it.readNBytes(32_769) } ?: error("Missing commission response")
            require(bytes.size <= 32_768)
            if (status !in 200..299) throw IllegalStateException("Commission request rejected")
            return parse(String(bytes, Charsets.UTF_8))
        } finally {
            connection.disconnect()
        }
    }

    private fun parse(raw: String): ProviderCommissionPage = try {
        val root = JSONObject(raw).also { exact(it, setOf("records", "nextAfter")) }
        val array = root.getJSONArray("records")
        require(array.length() <= 50)
        val records = (0 until array.length()).map { index -> parseRecord(array.getJSONObject(index)) }
        val next = if (root.isNull("nextAfter")) null else root.getJSONObject("nextAfter").let {
            exact(it, setOf("incomeId", "revision"))
            CommissionCursor(uuid(string(it, "incomeId")), integer(it, "revision", 1, Int.MAX_VALUE))
        }
        require(records.map { "${it.incomeId}/${it.revision}" }.toSet().size == records.size)
        if (next != null) require(records.lastOrNull()?.let { it.incomeId == next.incomeId && it.revision == next.revision } == true)
        ProviderCommissionPage(records, next)
    } catch (_: Exception) {
        throw IllegalStateException("Invalid commission response")
    }

    private fun parseRecord(json: JSONObject): ProviderCommissionRecord {
        exact(json, setOf(
            "incomeId", "revision", "currentForIncome", "identityId", "accountIdentityRef", "platform", "currency", "minorUnitScale",
            "produced", "receivedAt", "evaluatedAt", "receivedRevenueMinorUnits", "commissionMinorUnits", "appliedFraction", "rateVersion",
            "rounding", "moneyPolicyVersion", "calculationStage", "paymentStatus", "paymentAllowed",
        ))
        val produced = json.getJSONObject("produced").also { exact(it, setOf("startsAt", "endsAt")) }
        val platform = string(json, "platform").also { require(it in setOf("facebook", "youtube")) }
        val currency = string(json, "currency").also { require(it.matches(Regex("^[A-Z]{3}$"))) }
        val fraction = string(json, "appliedFraction").also { require(it.matches(Regex("^(?:0|1|0\\.[0-9]{1,18})$"))) }
        val rounding = string(json, "rounding").also { require(it in setOf("down", "half_up", "half_even")) }
        val stage = string(json, "calculationStage").also { require(it == "internal_calculation_only") }
        val paymentStatus = string(json, "paymentStatus").also { require(it == "not_recorded") }
        val paymentAllowed = json.get("paymentAllowed") as? Boolean ?: error("Invalid payment scope")
        require(!paymentAllowed)
        val accountRef = string(json, "accountIdentityRef").also { require(it.matches(Regex("^[A-Za-z0-9_-]{1,150}$"))) }
        val income = units(json, "receivedRevenueMinorUnits")
        val commission = units(json, "commissionMinorUnits")
        require(BigInteger(commission) <= BigInteger(income))
        val receivedAt = timestamp(string(json, "receivedAt"))
        val evaluatedAt = timestamp(string(json, "evaluatedAt"))
        val productionStart = timestamp(string(produced, "startsAt"))
        val productionEnd = timestamp(string(produced, "endsAt"))
        require(productionStart < productionEnd && productionEnd <= evaluatedAt && receivedAt <= evaluatedAt)
        return ProviderCommissionRecord(
            uuid(string(json, "incomeId")), integer(json, "revision", 1, Int.MAX_VALUE),
            json.get("currentForIncome") as? Boolean ?: error("Invalid revision marker"), accountRef, platform, currency,
            integer(json, "minorUnitScale", 0, 12), productionStart, productionEnd, receivedAt, evaluatedAt, income, commission,
            fraction, integer(json, "rateVersion", 1, Int.MAX_VALUE), rounding, integer(json, "moneyPolicyVersion", 1, Int.MAX_VALUE),
            stage, paymentStatus, paymentAllowed,
        )
    }

    private fun timestamp(raw: String) = Instant.parse(raw)
    private fun units(json: JSONObject, key: String) = string(json, key).also { require(it.length <= 78 && it.matches(Regex("^(?:0|[1-9][0-9]*)$"))) }
    private fun uuid(raw: String): UUID = UUID.fromString(raw).also { require(it.toString() == raw.lowercase()) }
    private fun integer(json: JSONObject, key: String, min: Int, max: Int): Int {
        val value = json.get(key) as? Number ?: error("Invalid integer")
        return java.math.BigDecimal(value.toString()).intValueExact().also { require(it in min..max) }
    }
    private fun string(json: JSONObject, key: String): String = json.get(key) as? String ?: error("Invalid string")
    private fun exact(json: JSONObject, keys: Set<String>) { require(json.keys().asSequence().toSet() == keys) }
}
