package com.socialgrowth.product

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.provider.Settings
import android.app.ActivityManager
import android.app.NotificationManager
import android.os.PowerManager

/** Local hints for the setup guide. They never grant network or ADB authority. */
internal data class DevicePreparationChecks(
    val wifiConnected: Boolean,
    val tailscaleInstalled: Boolean,
    val sfaInstalled: Boolean,
    val clashInstalled: Boolean,
    val vpnPresent: Boolean,
    val developerOptions: Boolean?,
    val wirelessDebugging: Boolean?,
    val discoverySupported: Boolean,
    val notificationsAllowed: Boolean = false,
    val backgroundRestricted: Boolean? = null,
    val batteryOptimizationExempt: Boolean? = null,
) {
    val networkClientInstalled: Boolean get() = tailscaleInstalled || sfaInstalled
    // These are local hints, not evidence of a live platform connection.
    val backgroundAllowed: Boolean get() = backgroundRestricted != true &&
        (batteryOptimizationExempt == true || backgroundRestricted == false)
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
                wifiConnected = networks.any { it.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) },
                tailscaleInstalled = context.packageManager.getLaunchIntentForPackage("com.tailscale.ipn") != null,
                sfaInstalled = context.packageManager.getLaunchIntentForPackage("io.nekohasekai.sfa") != null,
                clashInstalled = context.packageManager.getLaunchIntentForPackage("com.follow.clash") != null,
                vpnPresent = networks.any { it.hasTransport(NetworkCapabilities.TRANSPORT_VPN) },
                developerOptions = setting(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED),
                wirelessDebugging = if (Build.VERSION.SDK_INT >= 30) setting("adb_wifi_enabled") else false,
                discoverySupported = Build.VERSION.SDK_INT >= 34,
                notificationsAllowed = runCatching {
                    val notifications = context.getSystemService(NotificationManager::class.java)
                    notifications.areNotificationsEnabled() && (Build.VERSION.SDK_INT < 26 ||
                        notifications.getNotificationChannel("endpoint-reporting")?.importance != NotificationManager.IMPORTANCE_NONE)
                }.getOrDefault(false),
                backgroundRestricted = runCatching {
                    if (Build.VERSION.SDK_INT >= 28) context.getSystemService(ActivityManager::class.java).isBackgroundRestricted else false
                }.getOrNull(),
                batteryOptimizationExempt = runCatching {
                    context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)
                }.getOrNull(),
            )
        }
    }
}
