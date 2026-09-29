package com.socialgrowth.product

/** Read-only wording for facts shared with the provider. No network or authorization claims. */
object DeviceFactPresentation {
    fun state(state: String): String = when (state) {
        "associated_pending_access" -> "已关联 · 待完成接入"
        "access_ready" -> "接入已就绪"
        "paused" -> "已暂停"
        "exit_pending" -> "退出处理中"
        "exited" -> "已退出"
        "unassociated" -> "尚未关联"
        else -> "状态未知"
    }

    fun observation(lastObservedAt: String?): String =
        if (lastObservedAt == null) "暂无权威观察" else "有服务端观察记录"

    const val CONNECTION_UNKNOWN = "连接状态未知"
    const val ACCESS_BOUNDARY = "关联或接入状态不代表在线、平台授权有效或可以接任务。"
}
