package com.socialgrowth.product

internal enum class PreparationAction { NONE, ASSOCIATE, WIFI, NOTIFICATIONS, BACKGROUND, RESUME, START, DEVELOPER, DEBUGGING, LOGIN, PAIR, CHECK }

/** Pick only the next needed action. Local settings never establish remote authority. */
internal data class PhonePreparationPrompt(val title: String, val instruction: String, val button: String?, val action: PreparationAction) {
    companion object {
        fun next(local: DevicePreparationChecks, associated: Boolean, automatic: Boolean, reporting: Boolean,
                 managementLoggedIn: Boolean, fact: DeviceConnectionSnapshot?, failed: Boolean,
                 deviceState: String = "associated_pending_access"): PhonePreparationPrompt = when {
            !associated -> PhonePreparationPrompt("先关联这台手机", "确认这台手机属于你的账号后继续。", "关联本机", PreparationAction.ASSOCIATE)
            deviceState == "paused" -> PhonePreparationPrompt("这台手机已暂停", "如需继续，请在设备管理中查看并处理。", null, PreparationAction.NONE)
            deviceState in setOf("exited", "exit_pending") -> PhonePreparationPrompt("这台手机已退出或正在退出", "请在设备管理中查看结果。", null, PreparationAction.NONE)
            !local.discoverySupported -> PhonePreparationPrompt("暂不支持这台手机", "请联系邀请你的工作人员，确认支持的手机型号。", null, PreparationAction.NONE)
            !local.wifiConnected -> PhonePreparationPrompt("连接 Wi-Fi", "连接稳定的 Wi-Fi，完成后返回这里。", "打开 Wi-Fi 设置", PreparationAction.WIFI)
            !local.notificationsAllowed -> PhonePreparationPrompt("允许连接通知", "允许 SocialGrowth 通知，才能在系统配对弹窗打开时输入配对码。", "允许通知", PreparationAction.NOTIFICATIONS)
            !local.backgroundAllowed -> PhonePreparationPrompt("允许后台连接", "在应用设置中打开“电池”或“正在后台运行”，选择“不受限制”，然后返回。", "打开应用设置", PreparationAction.BACKGROUND)
            !automatic -> PhonePreparationPrompt("自动连接已暂停", "恢复后会继续检查手机连接。", "恢复自动连接", PreparationAction.RESUME)
            !reporting -> PhonePreparationPrompt("开启连接检查", "开启后，请保留通知栏中的 SocialGrowth 通知。", "开启连接检查", PreparationAction.START)
            local.developerOptions == false -> PhonePreparationPrompt("开启开发者选项", "打开“关于手机 → 软件信息”，连续点击“版本号”7 次，按系统提示确认。", "打开关于手机", PreparationAction.DEVELOPER)
            local.wirelessDebugging == false -> PhonePreparationPrompt("开启无线调试", "在开发者选项中开启“无线调试”，按系统提示允许当前 Wi-Fi。", "打开开发者选项", PreparationAction.DEBUGGING)
            fact?.connected == true && !failed -> PhonePreparationPrompt("等待平台完成准备", "暂时无需操作。需要你配合时，会在“我的设备”中提示。", null, PreparationAction.NONE)
            failed -> PhonePreparationPrompt("暂时联系不上平台", "请检查 Wi-Fi 后重试，已完成的设置不用重做。", "重新检查", PreparationAction.CHECK)
            fact?.pairingState == "unknown" -> PhonePreparationPrompt("正在核对上次配对", "先检查结果，暂不要再次输入配对码。", "检查配对结果", PreparationAction.CHECK)
            fact?.pairingState == "pairing" -> PhonePreparationPrompt("正在配对", "保持系统配对弹窗打开，等待通知中的结果。", null, PreparationAction.NONE)
            fact?.pairingState == "paired" || fact?.connectionState == "stale" -> PhonePreparationPrompt("正在恢复连接", "保持 Wi-Fi 和连接通知开启，无需重新配对。", "重新检查", PreparationAction.CHECK)
            fact == null || fact.blockerCode == "NETWORK_AUTHORITY_UNAVAILABLE" || fact.networkState !in setOf("admitted", "managed_verified", "pilot_verified", "bootstrap") ->
                PhonePreparationPrompt("正在确认连接", "已完成的设置不用重做。持续无法连接时，请联系邀请你的工作人员。", "重新检查", PreparationAction.CHECK)
            !managementLoggedIn -> PhonePreparationPrompt("先登录你的账号", "登录后返回这里完成手机配对。", "登录账号", PreparationAction.LOGIN)
            local.wirelessDebugging != true -> PhonePreparationPrompt("确认无线调试", "打开开发者选项，确认“无线调试”已开启。", "打开开发者选项", PreparationAction.DEBUGGING)
            else -> PhonePreparationPrompt("完成手机配对", "1. 打开无线调试，选择“使用配对码配对设备”。\n2. 保持弹窗打开，下拉并展开 SocialGrowth 通知。\n3. 在通知中输入 6 位配对码并发送。", "打开开发者选项", PreparationAction.PAIR)
        }
    }
}
