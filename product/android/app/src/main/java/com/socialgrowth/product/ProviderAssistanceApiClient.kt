package com.socialgrowth.product

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.UUID

internal data class AssistanceImpact(val deviceId: UUID, val deviceLabel: String, val recordedDeviceVersion: Long)
internal data class ProviderAssistanceTodo(
    val todoId: UUID,
    val kind: String,
    val status: String,
    val factVersion: Long,
    val impactCount: Int,
    val noteCount: Int,
    val createdAt: Instant,
    val updatedAt: Instant,
    val impacts: List<AssistanceImpact>,
)
internal data class ProviderAssistancePage(val todos: List<ProviderAssistanceTodo>, val nextAfterTodoId: UUID?)

internal class ProviderAssistanceApiClient(baseUrl: String) {
    private val base = URL(baseUrl).also {
        require(it.protocol in setOf("http", "https") && it.userInfo == null && it.query == null && it.ref == null)
        require(it.host.isNotBlank() && it.path in setOf("", "/"))
    }.toString().trimEnd('/')

    fun list(token: String, after: UUID? = null, pageSize: Int = 50): ProviderAssistancePage {
        require(token.matches(Regex("^[A-Za-z0-9_-]{43}$")) && pageSize in 1..50)
        val query = buildList {
            add("pageSize=$pageSize")
            after?.let { add("afterTodoId=$it") }
        }.joinToString("&")
        val connection = URL("$base/api/provider/assistance-todos?$query").openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "GET"
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 8_000
            connection.readTimeout = 10_000
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Authorization", "Bearer $token")
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val bytes = stream?.use { it.readAtMost(32_769) } ?: error("Missing assistance response")
            require(bytes.size <= 32_768)
            if (status !in 200..299) throw IllegalStateException("Assistance request rejected")
            return parse(String(bytes, Charsets.UTF_8))
        } finally {
            connection.disconnect()
        }
    }

    internal fun parse(raw: String): ProviderAssistancePage = try {
        val root = JSONObject(raw).also { exact(it, setOf("todos", "nextAfterTodoId")) }
        val array = root.getJSONArray("todos")
        require(array.length() <= 50)
        val todos = (0 until array.length()).map { index ->
            val todo = array.getJSONObject(index)
            exact(todo, setOf("todoId", "originScope", "kind", "status", "factVersion", "impactCount", "noteCount", "createdAt", "updatedAt", "impacts"))
            require(text(todo, "originScope") == "unassigned_device")
            val kind = text(todo, "kind").also { require(it == "network_access_help") }
            val status = text(todo, "status").also { require(it in setOf("open", "awaiting_recheck")) }
            val version = number(todo, "factVersion")
            val impactCount = number(todo, "impactCount").also { require(it in 1..Int.MAX_VALUE.toLong()) }.toInt()
            val noteCount = number(todo, "noteCount").also { require(it in 0..Int.MAX_VALUE.toLong()) }.toInt()
            require(status != "awaiting_recheck" || noteCount > 0)
            val impactsJson = todo.getJSONArray("impacts")
            require(impactsJson.length() in 0..300 && impactsJson.length() <= impactCount)
            val impacts = (0 until impactsJson.length()).map { impactIndex ->
                val impact = impactsJson.getJSONObject(impactIndex)
                exact(impact, setOf("deviceId", "deviceLabel", "recordedDeviceVersion"))
                val label = text(impact, "deviceLabel")
                require(label.codePointCount(0, label.length) in 1..100)
                AssistanceImpact(
                    uuid(text(impact, "deviceId")), label,
                    number(impact, "recordedDeviceVersion"),
                )
            }
            require(impacts.map { it.deviceId }.toSet().size == impacts.size)
            val createdAt = Instant.parse(text(todo, "createdAt"))
            val updatedAt = Instant.parse(text(todo, "updatedAt"))
            require(updatedAt >= createdAt)
            ProviderAssistanceTodo(
                uuid(text(todo, "todoId")), kind, status, version, impactCount, noteCount,
                createdAt, updatedAt, impacts,
            )
        }
        require(todos.map { it.todoId }.toSet().size == todos.size)
        val next = if (root.isNull("nextAfterTodoId")) null else uuid(text(root, "nextAfterTodoId"))
        require(next == null || next == todos.lastOrNull()?.todoId)
        ProviderAssistancePage(todos, next)
    } catch (_: Exception) {
        throw IllegalStateException("Invalid assistance response")
    }

    private fun exact(json: JSONObject, keys: Set<String>) { require(json.keys().asSequence().toSet() == keys) }
    private fun text(json: JSONObject, field: String): String = json.get(field) as? String
        ?: error("Invalid assistance field")
    private fun number(json: JSONObject, field: String): Long {
        val value = json.get(field) as? Number ?: error("Invalid assistance integer")
        val result = java.math.BigDecimal(value.toString()).longValueExact()
        require(result in 0..9_007_199_254_740_991L)
        return result
    }
    private fun uuid(value: String) = UUID.fromString(value).also { require(it.toString() == value.lowercase()) }
}
