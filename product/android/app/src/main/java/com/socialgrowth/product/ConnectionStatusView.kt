package com.socialgrowth.product

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.SystemClock
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.text.DateFormat
import java.util.Date

/** Only current server facts show a live connection; local VPN presence is insufficient. */
internal class ConnectionStatusView(context: Context, private val expanded: Boolean, var deviceState: String,
                                    private val localInstallation: Boolean = false,
                                    private val summaryOnly: Boolean = false) : LinearLayout(context) {
    private val neutral = Color.rgb(82, 97, 118)
    private val ink = Color.rgb(23, 43, 77)
    private val success = Color.rgb(20, 108, 67)
    private val warning = Color.rgb(143, 77, 0)
    private val headline = text("正在检查连接", if (summaryOnly) 24f else 20f, ink, true)
    private val detail = text("正在向平台确认，已有的关联不代表当前在线。", 14f, neutral)
    private val timestamp = text("尚未取得连接结果", 12f, neutral)
    private val network = text("待确认", 14f, ink)
    private val pairing = text("待确认", 14f, ink)
    private val connection = text("待确认", 14f, ink)
    private var checkedElapsed = 0L
    private var checkedWall = 0L
    var refreshAction: (() -> Unit)? = null
    private val refresh = Button(context).apply {
        text = "重新检查"
        textSize = 14f
        isAllCaps = false
        setTextColor(Color.rgb(36, 89, 196))
        background = android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x182459C4), null, null)
        minimumHeight = dp(48)
        setPadding(dp(8), 0, dp(8), 0)
        setOnClickListener { refreshAction?.invoke() }
    }
    init {
        orientation = VERTICAL
        addView(headline, LayoutParams(-1, -2))
        if (summaryOnly) {
            // This guide displays settings results separately and only the next manual action.
        } else if (expanded) {
            row(if (localInstallation) "网络连接" else "网络节点", network)
            row(if (localInstallation) "手机配对" else "调试配对", pairing)
            row("平台连接", connection)
            row("执行状态", text(when (deviceState) {
                "paused" -> "已暂停"
                "exited", "exit_pending" -> "已退出或退出中"
                else -> "待平台核验"
            }, 14f, neutral))
        } else {
            row(if (localInstallation) "网络连接" else "网络节点", network)
            row(if (localInstallation) "手机配对" else "调试配对", pairing)
        }
        if (!summaryOnly) addView(detail, LayoutParams(-1, -2).apply { topMargin = dp(8) })
        val footer = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
        footer.addView(timestamp, LayoutParams(0, -2, 1f))
        footer.addView(refresh, LayoutParams(-2, -2).apply { marginStart = dp(8) })
        addView(footer, LayoutParams(-1, -2).apply { topMargin = dp(4) })
        render(null)
    }
    fun render(fact: DeviceConnectionSnapshot?, failed: Boolean = false, refreshing: Boolean = false) {
        val automaticPaused = localInstallation && !EndpointReportingService.automaticEnabled(context)
        val color: Int
        headline.text = when {
            deviceState == "unassociated" -> "尚未关联本机"
            automaticPaused -> "自动连接已暂停"
            failed -> "暂时无法确认连接"
            fact == null -> if (checkedWall == 0L) "正在检查连接" else "连接状态待更新"
            deviceState == "paused" -> "执行已暂停"
            deviceState in setOf("exited", "exit_pending") -> "设备已退出或退出中"
            fact.connected && localInstallation -> "手机已连接"
            fact.connected && fact.networkState == "bootstrap" -> "首次连接已建立"
            fact.connected -> "平台已连接"
            fact.blockerCode == "NETWORK_AUTHORITY_UNAVAILABLE" -> "平台网络待确认"
            fact.networkState == "not_configured" -> "等待网络配置"
            fact.networkState == "blocked" -> "网络接入待处理"
            fact.networkState !in setOf("admitted", "managed_verified", "pilot_verified", "bootstrap") -> "网络尚未确认"
            fact.pairingState == "pairing" -> "正在配对"
            fact.pairingState in setOf("awaiting_code", "expired", "not_started") -> "待完成配对"
            fact.connectionState == "connecting" -> "正在连接"
            fact.connectionState == "stale" -> "连接暂时中断"
            else -> "连接尚未确认"
        }
        color = when {
            automaticPaused -> neutral
            fact?.connected == true && !failed && deviceState !in setOf("paused", "exited", "exit_pending") -> success
            fact != null && !failed -> warning
            else -> neutral
        }
        headline.setTextColor(color)
        network.text = if (fact?.blockerCode == "NETWORK_AUTHORITY_UNAVAILABLE") "待确认" else when (fact?.networkState) {
            "bootstrap" -> "首次连接已建立"
            "admitted", "managed_verified", "pilot_verified" -> "已确认"
            "blocked" -> "暂未通过"
            "not_configured" -> "未配置"
            "pending" -> "接入中"
            else -> "待确认"
        }
        pairing.text = if (fact?.blockerCode == "NETWORK_AUTHORITY_UNAVAILABLE") "待平台确认" else when (fact?.pairingState) {
            "paired" -> "已配对"
            "pairing" -> "配对中"
            "awaiting_code" -> "等待输入配对码"
            "expired" -> "配对码已过期"
            "not_started" -> "尚未配对"
            else -> "待确认"
        }
        connection.text = when {
            fact?.connected == true -> "已连接"
            fact?.connectionState == "connecting" -> "连接中"
            fact?.connectionState == "stale" -> "需重新确认"
            else -> "待确认"
        }
        detail.text = when {
            deviceState == "unassociated" -> "请先返回设备管理，确认关联这台手机，再继续连接设置。"
            automaticPaused -> "你已暂停自动连接。请在本机准备中恢复；不会因此恢复业务任务。"
            failed -> "暂时联系不上平台，请重新检查。现在无法判断手机是否离线。"
            fact == null -> "正在重新确认当前连接，不会因此重复配对或启动任务。"
            fact.connected && localInstallation -> "需要你操作时，请查看手机准备。"
            fact.connected && fact.networkState == "bootstrap" -> "可由运营继续准备，尚待核验。"
            fact.connected -> if (expanded) "连接正常。执行资格和任务状态由平台另行核验。" else "网络已确认 · 已配对。连接正常不代表任务已经开始。"
            else -> DeviceConnectionBoundary.message(fact)
        }
        setRefreshing(refreshing)
        updateTimestamp()
    }
    fun setRefreshing(refreshing: Boolean) {
        refresh.isEnabled = !refreshing && deviceState != "unassociated"
        refresh.text = if (refreshing) "检查中…" else "重新检查"
    }
    fun accept(fact: DeviceConnectionSnapshot) {
        checkedElapsed = SystemClock.elapsedRealtime()
        checkedWall = System.currentTimeMillis()
        render(fact)
    }
    fun isFresh() = checkedElapsed != 0L && SystemClock.elapsedRealtime() - checkedElapsed < 10_000
    fun updateTimestamp() {
        timestamp.text = if (checkedWall == 0L) "尚未取得连接结果" else "检查于 ${DateFormat.getTimeInstance(DateFormat.MEDIUM).format(Date(checkedWall))}"
    }
    private fun row(title: String, value: TextView) {
        val line = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
        line.addView(text(title, 14f, neutral), LayoutParams(0, -2, 1f))
        line.addView(value, LayoutParams(-2, -2))
        addView(line, LayoutParams(-1, -2).apply { topMargin = dp(8) })
    }
    private fun text(value: String, size: Float, color: Int, bold: Boolean = false) = TextView(context).apply {
        text = value; textSize = size; setTextColor(color)
        if (bold) setTypeface(typeface, Typeface.BOLD)
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
}
