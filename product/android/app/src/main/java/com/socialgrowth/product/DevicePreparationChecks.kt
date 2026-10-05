package com.socialgrowth.product

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.provider.Settings

/** Local hints for the setup guide. They never grant network or ADB authority. */
internal data class DevicePreparationChecks(
    val wifiConnected: Boolean,
    val tailscaleInstalled: Boolean,
    val vpnPresent: Boolean,
    val developerOptions: Boolean?,
    val wirelessDebugging: Boolean?,
    val discoverySupported: Boolean,
) {
    companion object {
        fun read(context: Context): DevicePreparationChecks {
            val networks = runCatching {
                val manager = context.getSystemService(ConnectivityManager::class.java)
                manager.allNetworks.mapNotNull(manager::getNetworkCapabilities)
            }.getOrDefault(emptyList())
            fun setting(name: String): Boolean? = runCatching {
                when (Settings.Global.getInt(context.contentResolver, name, -1)) {
                    0 -> false
                    1 -> true
                    else -> null
                }
            }.getOrNull()
            return DevicePreparationChecks(
                wifiConnected = networks.any { it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) },
                tailscaleInstalled = context.packageManager.getLaunchIntentForPackage("com.tailscale.ipn") != null,
                vpnPresent = networks.any { it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) },
                developerOptions = setting(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED),
                wirelessDebugging = if (Build.VERSION.SDK_INT >= 30) setting("adb_wifi_enabled") else false,
                discoverySupported = Build.VERSION.SDK_INT >= 34,
            )
        }
    }
}
