package com.socialgrowth.product

import java.net.URI
import java.net.URLDecoder

internal object ProviderInvitation {
    private val format = Regex("^[A-Za-z0-9_-]{43}$")
    fun parse(value: String, apiBaseUrl: String): String? {
        val text = value.trim()
        if (format.matches(text)) return text
        return runCatching {
            val uri = URI(text)
            val base = URI(apiBaseUrl)
            val web = uri.scheme == "https" && uri.host.equals(base.host, ignoreCase = true) &&
                (if (uri.port == -1) 443 else uri.port) == (if (base.port == -1) 443 else base.port) && uri.path == "/register"
            val app = uri.scheme == "socialgrowth" && uri.host == "provider" && uri.port == -1 && uri.path == "/register"
            if ((!web && !app) || uri.rawUserInfo != null || uri.rawFragment != null) return null
            val query = uri.rawQuery?.split('&') ?: return null
            if (query.size != 1) return null
            val parts = query.single().split('=', limit = 2)
            if (parts.size != 2 || parts[0] !in setOf("invitation", "code")) return null
            val code = URLDecoder.decode(parts[1], "UTF-8")
            code.takeIf(format::matches)
        }.getOrNull()
    }
}
