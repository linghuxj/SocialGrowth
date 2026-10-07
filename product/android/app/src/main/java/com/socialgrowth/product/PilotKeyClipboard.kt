package com.socialgrowth.product

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PersistableBundle
import java.util.UUID

/** Application lifetime; no Activity, key text, or UI handler retained by the timer. */
internal object PilotKeyClipboard {
    private val handler = Handler(Looper.getMainLooper())
    private var ownedLabel: String? = null
    private var pending: Runnable? = null

    fun copy(context: Context, key: String) {
        clearOwned(context)
        val clipboard = context.applicationContext.getSystemService(ClipboardManager::class.java)
        val label = "SocialGrowth 接入密钥 ${UUID.randomUUID()}"
        val clip = ClipData.newPlainText(label, key)
        clip.description.extras = PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
        clipboard.setPrimaryClip(clip)
        ownedLabel = label
        val app = context.applicationContext
        pending = Runnable { clearOwned(app) }.also { handler.postDelayed(it, 60_000) }
    }

    fun clearOwned(context: Context) {
        val label = ownedLabel ?: return
        // Android can restrict clipboard access while backgrounded. Never clear
        // another application's later copy or claim an unconditional OS guarantee.
        val clipboard = context.applicationContext.getSystemService(ClipboardManager::class.java)
        if (clipboard.primaryClipDescription?.label?.toString() == label) {
            if (Build.VERSION.SDK_INT >= 28) clipboard.clearPrimaryClip()
            else clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
            ownedLabel = null
            pending?.let { handler.removeCallbacks(it) }
            pending = null
        }
    }
}
