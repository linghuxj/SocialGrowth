package com.socialgrowth.product

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import com.google.zxing.BarcodeFormat
import com.journeyapps.barcodescanner.BarcodeEncoder
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
    private val blue = Color.rgb(36, 89, 196)
    private val canvas = Color.rgb(244, 246, 250)
    private val ink = Color.rgb(23, 43, 77)
    private val secondary = Color.rgb(82, 97, 118)
    private val dividerColor = Color.rgb(220, 226, 234)
    private val danger = Color.rgb(180, 35, 24)
    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var api: ProviderApiClient
    private lateinit var associationApi: AssociationApiClient
    private lateinit var sessionStore: ProviderSessionStore
    private lateinit var installationStore: InstallationIdentityStore
    private var registrationMode = true
    private var invitationCode: String? = null
    private var challenge: PhoneVerificationChallenge? = null
    private var challengeKey = newIdempotencyKey("challenge")
    private var verifyKey = newIdempotencyKey("verify")
    private var authKey = newIdempotencyKey("auth")
    private var lastCode = ""
    private var screenGeneration = 0
    private var associationConfirmKey = newIdempotencyKey("association-confirm")
    private val barcodeLauncher = registerForActivityResult(ScanContract()) { result ->
        result.contents?.let(::handleAssociationPayload)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        api = ProviderApiClient(BuildConfig.API_BASE_URL)
        associationApi = AssociationApiClient(api)
        sessionStore = ProviderSessionStore(this)
        installationStore = InstallationIdentityStore(this)
        invitationCode = intent?.data?.getQueryParameter("invitation")
            ?: intent?.data?.getQueryParameter("code")
            ?: intent?.getStringExtra("invitation")
        if (installationStore.exists()) {
            showInstallationLoading()
            return
        }
        sessionStore.load()?.let { session ->
            showManagement(session)
            return
        }
        showAuthForm()
    }

    override fun onDestroy() {
        executor.shutdownNow()
        super.onDestroy()
    }

    private fun showAuthForm() {
        val root = vertical(20).apply {
            setBackgroundColor(canvas)
            setPadding(dp(20), dp(20), dp(20), dp(72))
            minimumHeight = resources.displayMetrics.heightPixels - dp(48)
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }

        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(ImageButton(this).apply {
            val up = TypedValue()
            if (theme.resolveAttribute(android.R.attr.homeAsUpIndicator, up, true)) {
                setImageResource(up.resourceId)
            } else {
                setImageResource(android.R.drawable.ic_menu_revert)
            }
            setColorFilter(ink)
            background = null
            contentDescription = "返回"
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        header.addView(label("SocialGrowth", 20f, ink, Typeface.BOLD), wrapWrap().apply {
            marginStart = dp(6)
        })
        root.addView(header, matchWrap())
        root.addView(label(if (registrationMode) "受邀加入" else "手机号登录", 32f, ink, Typeface.BOLD), matchWrap().apply {
            topMargin = dp(22)
        })
        root.addView(label(
            if (registrationMode) "完成手机号验证，管理你的执行手机。" else "验证原手机号，回到你的管理身份。",
            16f,
            secondary,
        ), matchWrap().apply { topMargin = dp(8) })

        val invitationValid = invitationCode?.matches(Regex("^[A-Za-z0-9_-]{43}$")) == true
        val status = vertical(14).apply {
            background = rounded(if (invitationValid || !registrationMode) Color.rgb(234, 246, 239) else Color.WHITE, 10)
        }
        setStatus(
            status,
            if (registrationMode && invitationValid) "邀请待校验" else if (registrationMode) "需要有效邀请" else "已有账号登录",
            if (registrationMode) "完成验证后才能注册。" else "登录不会将本机接入执行。",
            registrationMode && !invitationValid,
        )
        root.addView(status, matchWrap().apply { topMargin = dp(22) })

        val card = vertical(18).apply {
            background = rounded(Color.WHITE, 12)
            elevation = dp(2).toFloat()
        }
        val phone = editText("请输入手机号", InputType.TYPE_CLASS_PHONE).apply {
            id = R.id.provider_phone
            contentDescription = "手机号"
            imeOptions = EditorInfo.IME_ACTION_NEXT
        }
        card.addView(fieldLabel("手机号"))
        card.addView(phone, matchHeight(54).apply { topMargin = dp(8) })
        card.addView(fieldLabel("短信验证码"), matchWrap().apply { topMargin = dp(18) })
        val codeRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val code = editText("请输入短信验证码", InputType.TYPE_CLASS_NUMBER).apply {
            id = R.id.provider_code
            contentDescription = "短信验证码"
            imeOptions = EditorInfo.IME_ACTION_DONE
        }
        codeRow.addView(code, LinearLayout.LayoutParams(0, dp(54), 1f))
        val requestCode = secondaryButton("获取验证码").apply {
            id = R.id.provider_request_code
            contentDescription = "获取验证码"
            isEnabled = !registrationMode || invitationValid
        }
        codeRow.addView(requestCode, LinearLayout.LayoutParams(dp(118), dp(54)).apply { marginStart = dp(10) })
        card.addView(codeRow, matchWrap().apply { topMargin = dp(8) })
        val error = label("", 13f, danger).apply {
            id = R.id.provider_error
            visibility = View.GONE
        }
        card.addView(error, matchWrap().apply { topMargin = dp(10) })
        val submitLabel = if (registrationMode) "注册并进入管理" else "登录并进入管理"
        val submit = primaryButton(submitLabel).apply {
            id = R.id.provider_submit
            contentDescription = submitLabel
        }
        card.addView(submit, matchHeight(54).apply { topMargin = dp(18) })
        card.addView(label(
            if (registrationMode) "注册不会将本机接入执行。" else "登录不会将本机接入执行。",
            13f,
            secondary,
        ).apply { gravity = Gravity.CENTER }, matchWrap().apply {
            topMargin = dp(12)
        })
        root.addView(card, matchWrap().apply { topMargin = dp(18) })

        root.addView(Button(this).apply {
            id = R.id.provider_switch_mode
            text = if (registrationMode) "已有账号？手机号登录" else "收到邀请？返回受邀注册"
            textSize = 15f
            setTextColor(blue)
            background = null
            isAllCaps = false
            minHeight = dp(48)
            setOnClickListener {
                registrationMode = !registrationMode
                challenge = null
                resetAttemptKeys()
                showAuthForm()
            }
        }, matchHeight(52).apply { topMargin = dp(8) })
        root.addView(divider(), matchHeight(1).apply { topMargin = dp(10) })
        root.addView(label("加入后，可逐台扫码关联专用执行手机。", 14f, secondary).apply { gravity = Gravity.CENTER }, matchWrap().apply {
            topMargin = dp(24)
        })
        root.addView(secondaryButton("将这台手机作为执行手机接入").apply {
            id = R.id.installation_mode
            contentDescription = "将这台手机作为执行手机接入"
            setOnClickListener {
                try {
                    installationStore.ensureCredential()
                    showInstallationLoading()
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "无法安全建立本机身份，请重试。", Toast.LENGTH_LONG).show()
                }
            }
        }, matchHeight(54).apply { topMargin = dp(16) })
        root.addView(View(this), LinearLayout.LayoutParams(1, 0, 1f))

        requestCode.setOnClickListener {
            val phoneValue = phone.text.toString().trim()
            if (!phoneValue.matches(Regex("^\\+[1-9][0-9]{7,14}$"))) {
                showError(error, "请输入带国际区号的完整手机号，例如以 + 开头。")
                return@setOnClickListener
            }
            setBusy(true, requestCode, submit, error, card)
            runNetwork(
                action = {
                    api.requestVerification(
                        phoneValue,
                        if (registrationMode) "provider_registration" else "provider_login",
                        invitationCode,
                        challengeKey,
                    )
                },
                success = { result ->
                    challenge = result
                    requestCode.text = "验证码已受理"
                    setStatus(status, if (registrationMode) "邀请已校验" else "账号已确认", "请填写验证码继续。", false)
                    setBusy(false, requestCode, submit, error, card)
                    requestCode.isEnabled = false
                },
                failure = { message ->
                    showError(error, message)
                    setBusy(false, requestCode, submit, error, card)
                },
            )
        }

        submit.setOnClickListener {
            val activeChallenge = challenge
            if (activeChallenge == null) {
                showError(error, "请先获取验证码。")
                return@setOnClickListener
            }
            val codeValue = code.text.toString().trim()
            if (!codeValue.matches(Regex("^[0-9]{4,8}$"))) {
                showError(error, "请输入收到的数字验证码。")
                return@setOnClickListener
            }
            if (codeValue != lastCode) {
                lastCode = codeValue
                verifyKey = newIdempotencyKey("verify")
            }
            setBusy(true, requestCode, submit, error, card)
            runNetwork(
                action = {
                    val proof = api.verifyCode(activeChallenge.challengeId, codeValue, verifyKey)
                    if (registrationMode) api.register(invitationCode!!, proof.phoneVerificationId, authKey)
                    else api.login(proof.phoneVerificationId, authKey)
                },
                success = { auth ->
                    try {
                        sessionStore.save(auth)
                        showManagement(auth.toStored())
                    } catch (_: Exception) {
                        showError(error, "无法安全保存登录状态，请重试。")
                        setBusy(false, requestCode, submit, error, card)
                    }
                },
                failure = { message ->
                    showError(error, message)
                    setBusy(false, requestCode, submit, error, card)
                },
            )
        }
        setContentView(scroll)
    }

    private fun showManagement(session: StoredProviderSession) {
        val generation = ++screenGeneration
        val content = vertical(20).apply { setBackgroundColor(canvas) }
        content.addView(appHeader("设备管理"), matchWrap())
        content.addView(label("执行手机", 30f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(22) })
        content.addView(label("${session.displayName} · ${session.phoneHint}", 14f, secondary), matchWrap().apply { topMargin = dp(7) })
        val add = primaryButton("添加执行手机").apply {
            id = R.id.provider_add_device
            contentDescription = "扫码添加执行手机"
            setOnClickListener { startAssociationScan() }
        }
        content.addView(add, matchHeight(54).apply { topMargin = dp(22) })
        content.addView(label("扫码只用于核对设备；确认前不会建立归属。", 13f, secondary).apply {
            gravity = Gravity.CENTER
        }, matchWrap().apply { topMargin = dp(9) })
        content.addView(label("我的设备", 18f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(28) })
        val devices = vertical(0).apply { id = R.id.provider_device_list }
        devices.addView(label("正在读取设备…", 14f, secondary), matchWrap().apply { topMargin = dp(12) })
        content.addView(devices, matchWrap())
        val logout = secondaryButton("退出管理登录").apply {
            id = R.id.provider_logout
            setOnClickListener {
                isEnabled = false
                text = "正在退出…"
                runNetwork(
                    action = { api.logout(session.sessionToken, newIdempotencyKey("logout")); true },
                    success = {
                        sessionStore.clear()
                        resetAttemptKeys()
                        showAuthForm()
                    },
                    failure = { message ->
                        isEnabled = true
                        text = "退出管理登录"
                        Toast.makeText(this@MainActivity, message, Toast.LENGTH_LONG).show()
                    },
                )
            }
        }
        content.addView(logout, matchHeight(54).apply { topMargin = dp(30) })
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(content, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        setContentView(scroll)
        runNetwork(
            action = { associationApi.devices(session.sessionToken) },
            success = { list -> if (generation == screenGeneration) renderDevices(devices, list) },
            failure = { message -> if (generation == screenGeneration) renderDeviceError(devices, message) },
        )
    }

    private fun showInstallationLoading() {
        val generation = ++screenGeneration
        val root = vertical(20).apply {
            setBackgroundColor(canvas)
            gravity = Gravity.CENTER_HORIZONTAL
        }
        root.addView(label("正在准备本机安全身份…", 18f, ink, Typeface.BOLD), wrapWrap().apply { topMargin = dp(160) })
        root.addView(label("根凭据只保存在本机安全存储中。", 14f, secondary), wrapWrap().apply { topMargin = dp(12) })
        setContentView(root)
        executor.execute {
            try {
                var stored = installationStore.ensureCredential()
                var token = stored.activeSessionToken()
                if (token == null) {
                    val auth = associationApi.bootstrap(stored.credential, newIdempotencyKey("installation-bootstrap"))
                    stored = installationStore.saveAuth(stored, auth)
                    token = stored.activeSessionToken() ?: error("inactive installation session")
                }
                val state = associationApi.installationState(token)
                if (state.state == "unassociated") {
                    val existing = stored.activeAssociation()
                    val association = if (existing != null) {
                        existing
                    } else {
                        associationApi.createAssociationSession(
                            token,
                            executionDeviceLabel(),
                            newIdempotencyKey("association-session"),
                        ).also { stored = installationStore.saveAssociation(stored, it) }
                    }
                    mainHandler.post {
                        if (generation == screenGeneration) showInstallationCode(stored, association)
                    }
                } else {
                    installationStore.clearAssociation(stored)
                    mainHandler.post {
                        if (generation == screenGeneration) showInstallationAssociated(state)
                    }
                }
            } catch (error: ProviderApiException) {
                mainHandler.post { if (generation == screenGeneration) showInstallationFailure(error.message) }
            } catch (_: Exception) {
                mainHandler.post { if (generation == screenGeneration) showInstallationFailure("无法连接服务，请检查网络后重试。") }
            }
        }
    }

    private fun showInstallationCode(
        identity: StoredInstallationIdentity,
        association: AssociationSession,
    ) {
        val generation = ++screenGeneration
        val payload = JSONObject()
            .put("contractVersion", ProviderApiClient.CONTRACT_VERSION)
            .put("associationCode", association.associationCode)
            .toString()
        val root = vertical(20).apply { setBackgroundColor(canvas) }
        root.addView(backHeader("") {
            showInstallationGuide(identity, association)
        }, matchWrap())
        root.addView(label("关联这台执行手机", 29f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(20) })
        root.addView(label("请用已登录的管理手机扫码", 16f, secondary), matchWrap().apply { topMargin = dp(7) })
        val qrCard = vertical(18).apply {
            background = rounded(Color.WHITE, 12)
            gravity = Gravity.CENTER_HORIZONTAL
            elevation = dp(2).toFloat()
        }
        qrCard.addView(label("本机 ${shortDeviceName()}", 18f, ink, Typeface.BOLD).apply {
            gravity = Gravity.CENTER
        }, matchWrap())
        val qrImage = ImageView(this).apply {
            id = R.id.installation_qr
            contentDescription = "本机关联二维码"
            setImageBitmap(qrBitmap(payload))
        }
        qrCard.addView(qrImage, LinearLayout.LayoutParams(dp(208), dp(208)).apply { topMargin = dp(14) })
        val associationStatus = label("等待管理手机确认", 16f, ink, Typeface.BOLD).apply {
            gravity = Gravity.CENTER
            background = rounded(canvas, 8)
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        qrCard.addView(associationStatus, matchWrap().apply { topMargin = dp(14) })
        val expiryLabel = label("二维码将在 ${formatExpiry(association.expiresAt)} 失效", 13f, secondary).apply {
            gravity = Gravity.CENTER
        }
        qrCard.addView(expiryLabel, matchWrap().apply { topMargin = dp(6) })
        root.addView(qrCard, matchWrap().apply { topMargin = dp(20) })
        val steps = vertical(18).apply { background = rounded(Color.WHITE, 12) }
        steps.addView(label("在管理手机上操作", 17f, ink, Typeface.BOLD))
        steps.addView(stepRow("1", "在管理手机进入“设备管理”并点击“添加执行手机”"))
        steps.getChildAt(1).layoutParams = matchWrap().apply { topMargin = dp(14) }
        steps.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        steps.addView(stepRow("2", "核对设备信息后明确确认关联"))
        root.addView(steps, matchWrap().apply { topMargin = dp(16) })
        root.addView(label("关联只建立设备归属，平台授权与接入检查仍需后续完成。", 13f, secondary), matchWrap().apply { topMargin = dp(14) })
        root.addView(secondaryButton("返回接入说明").apply {
            setOnClickListener {
                showInstallationGuide(identity, association)
            }
        }, matchHeight(52).apply { topMargin = dp(18) })
        val refresh = secondaryButton("关联码已失效，刷新").apply {
            id = R.id.installation_refresh
            visibility = View.GONE
            setOnClickListener {
                isEnabled = false
                val token = identity.activeSessionToken()
                if (token == null) showInstallationLoading()
                else runNetwork(
                    action = {
                        associationApi.createAssociationSession(
                            token,
                            executionDeviceLabel(),
                            newIdempotencyKey("association-session"),
                        )
                    },
                    success = { next ->
                        val updated = installationStore.saveAssociation(identity, next)
                        showInstallationCode(updated, next)
                    },
                    failure = { showInstallationFailure(it) },
                )
            }
        }
        root.addView(refresh, matchHeight(52).apply { topMargin = dp(10) })
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        setContentView(scroll)
        val refreshDelay = (displayInstant(association.expiresAt).toEpochMilli() - System.currentTimeMillis())
            .coerceAtLeast(0L)
        mainHandler.postDelayed({
            if (generation == screenGeneration) {
                qrImage.setImageDrawable(null)
                qrImage.setBackgroundColor(canvas)
                qrImage.contentDescription = "关联二维码已失效"
                associationStatus.text = "关联码已失效"
                associationStatus.setTextColor(danger)
                expiryLabel.text = "请刷新后重新扫码"
                refresh.visibility = View.VISIBLE
            }
        }, refreshDelay)
        pollInstallationState(generation, identity)
    }

    private fun showInstallationGuide(
        identity: StoredInstallationIdentity,
        association: AssociationSession,
    ) {
        ++screenGeneration
        val root = vertical(20).apply { setBackgroundColor(canvas) }
        root.addView(backHeader("执行手机接入") { showInstallationCode(identity, association) }, matchWrap())
        root.addView(label("执行手机接入说明", 29f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(24) })
        root.addView(label("这台手机将作为专用执行端，不会获得管理身份。", 15f, secondary), matchWrap().apply { topMargin = dp(8) })
        val card = vertical(18).apply { background = rounded(Color.WHITE, 12) }
        card.addView(stepRow("1", "本机安全保存独立安装身份，不保存管理账号凭据"))
        card.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        card.addView(stepRow("2", "管理手机扫码核对并明确确认后，才建立设备归属"))
        card.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        card.addView(stepRow("3", "清除数据或重装会生成新身份，不会自动认领旧设备"))
        root.addView(card, matchWrap().apply { topMargin = dp(22) })
        root.addView(label("完成关联后仍需平台授权和接入检查，才能承担执行任务。", 14f, secondary), matchWrap().apply { topMargin = dp(18) })
        root.addView(primaryButton("继续显示关联码").apply {
            setOnClickListener { showInstallationCode(identity, association) }
        }, matchHeight(54).apply { topMargin = dp(24) })
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        setContentView(scroll)
    }

    private fun pollInstallationState(generation: Int, identity: StoredInstallationIdentity) {
        mainHandler.postDelayed({
            if (generation != screenGeneration) return@postDelayed
            val token = identity.activeSessionToken() ?: return@postDelayed showInstallationLoading()
            runNetwork(
                action = { associationApi.installationState(token) },
                success = { state ->
                    if (generation != screenGeneration) return@runNetwork
                    if (state.state == "unassociated") pollInstallationState(generation, identity)
                    else {
                        installationStore.clearAssociation(identity)
                        showInstallationAssociated(state)
                    }
                },
                failure = {
                    if (generation == screenGeneration) pollInstallationState(generation, identity)
                },
            )
        }, 3_000)
    }

    private fun showInstallationAssociated(state: InstallationSelfView) {
        ++screenGeneration
        val root = vertical(24).apply {
            setBackgroundColor(canvas)
            gravity = Gravity.CENTER_HORIZONTAL
        }
        root.addView(label("✓", 54f, Color.rgb(20, 108, 67), Typeface.BOLD), wrapWrap().apply { topMargin = dp(96) })
        root.addView(label("执行手机已关联", 28f, ink, Typeface.BOLD), wrapWrap().apply { topMargin = dp(18) })
        root.addView(label("本机 ${shortDeviceName()}", 16f, secondary), wrapWrap().apply { topMargin = dp(8) })
        root.addView(label("下一步仍需完成平台授权和接入检查。", 14f, secondary).apply {
            gravity = Gravity.CENTER
        }, matchWrap().apply { topMargin = dp(22) })
        root.addView(label("设备状态：${localizedDeviceState(state.state)}", 14f, ink, Typeface.BOLD), wrapWrap().apply { topMargin = dp(18) })
        root.addView(secondaryButton("刷新状态").apply { setOnClickListener { showInstallationLoading() } }, matchHeight(54).apply { topMargin = dp(28) })
        setContentView(root)
    }

    private fun showInstallationFailure(message: String) {
        ++screenGeneration
        val root = vertical(24).apply {
            setBackgroundColor(canvas)
            gravity = Gravity.CENTER_HORIZONTAL
        }
        root.addView(label("暂时无法准备关联码", 24f, ink, Typeface.BOLD), wrapWrap().apply { topMargin = dp(120) })
        root.addView(label(message, 14f, danger).apply { gravity = Gravity.CENTER }, matchWrap().apply { topMargin = dp(14) })
        root.addView(primaryButton("重试").apply { setOnClickListener { showInstallationLoading() } }, matchHeight(54).apply { topMargin = dp(24) })
        setContentView(root)
    }

    private fun startAssociationScan() {
        barcodeLauncher.launch(
            ScanOptions()
            .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setPrompt("扫描执行手机上的关联二维码")
            .setBeepEnabled(false)
            .setOrientationLocked(false)
        )
    }

    private fun handleAssociationPayload(raw: String) {
        val session = sessionStore.load()
        if (session == null) {
            Toast.makeText(this, "管理登录已失效，请重新登录。", Toast.LENGTH_LONG).show()
            showAuthForm()
            return
        }
        val qr = try {
            FirstBatchContractBoundary.parseAssociationQrPayload(raw)
        } catch (_: Exception) {
            Toast.makeText(this, "这不是有效的 SocialGrowth 设备关联码。", Toast.LENGTH_LONG).show()
            return
        }
        val loading = vertical(24).apply {
            setBackgroundColor(canvas)
            gravity = Gravity.CENTER_HORIZONTAL
            addView(label("正在安全核对设备…", 18f, ink, Typeface.BOLD), wrapWrap().apply { topMargin = dp(160) })
        }
        setContentView(loading)
        runNetwork(
            action = { associationApi.inspect(session.sessionToken, qr.associationCode) },
            success = { showAssociationConfirmation(session, it) },
            failure = {
                Toast.makeText(this, it, Toast.LENGTH_LONG).show()
                showManagement(session)
            },
        )
    }

    private fun showAssociationConfirmation(
        session: StoredProviderSession,
        inspection: AssociationInspection,
    ) {
        ++screenGeneration
        associationConfirmKey = newIdempotencyKey("association-confirm")
        val root = vertical(20).apply { setBackgroundColor(canvas) }
        root.addView(backHeader("添加执行手机") { showManagement(session) }, matchWrap())
        root.addView(label("核对关联设备", 29f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(20) })
        root.addView(label("已识别关联码，请核对目标手机。", 15f, secondary), matchWrap().apply { topMargin = dp(7) })
        val device = vertical(18).apply { background = rounded(Color.WHITE, 12); elevation = dp(2).toFloat() }
        device.addView(label(inspection.deviceLabel, 20f, ink, Typeface.BOLD))
        device.addView(detailRow("当前提供者", session.displayName), matchWrap().apply { topMargin = dp(18) })
        device.addView(detailRow("验证手机号", session.phoneHint), matchWrap().apply { topMargin = dp(12) })
        device.addView(detailRow("目标设备", inspection.deviceLabel), matchWrap().apply { topMargin = dp(12) })
        device.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        device.addView(label("请核对执行手机上显示的设备标识。", 13f, secondary))
        root.addView(device, matchWrap().apply { topMargin = dp(20) })
        root.addView(label("关联后还需要", 18f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(24) })
        val next = vertical(18).apply { background = rounded(Color.WHITE, 12) }
        next.addView(explanationRow("1", "完成平台账号授权"))
        next.addView(explanationRow("2", "检查目标主页或频道权限"), matchWrap().apply { topMargin = dp(14) })
        next.addView(explanationRow("3", "通过接入准备检查后才能执行"), matchWrap().apply { topMargin = dp(14) })
        root.addView(next, matchWrap().apply { topMargin = dp(12) })
        val error = label("", 13f, danger).apply { visibility = View.GONE }
        root.addView(error, matchWrap().apply { topMargin = dp(12) })
        val confirm = primaryButton("确认关联这台执行手机").apply {
            id = R.id.association_confirm
            setOnClickListener {
                isEnabled = false
                text = "正在确认…"
                error.visibility = View.GONE
                runNetwork(
                    action = {
                        associationApi.result(session.sessionToken, inspection)
                            ?: associationApi.confirm(session.sessionToken, inspection, associationConfirmKey)
                    },
                    success = { receipt -> showAssociationSuccess(session, receipt) },
                    failure = { message ->
                        isEnabled = true
                        text = "确认关联这台执行手机"
                        showError(error, message)
                    },
                )
            }
        }
        root.addView(confirm, matchHeight(54).apply { topMargin = dp(18) })
        root.addView(secondaryButton("重新扫码").apply {
            id = R.id.association_rescan
            setOnClickListener { startAssociationScan() }
        }, matchHeight(52).apply { topMargin = dp(10) })
        root.addView(label("关联不会把当前管理手机接入执行。", 13f, secondary).apply {
            gravity = Gravity.CENTER
        }, matchWrap().apply { topMargin = dp(13) })
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        setContentView(scroll)
    }

    private fun showAssociationSuccess(session: StoredProviderSession, receipt: AssociationReceipt) {
        ++screenGeneration
        val root = vertical(24).apply { setBackgroundColor(canvas); gravity = Gravity.CENTER_HORIZONTAL }
        root.addView(label("✓", 54f, Color.rgb(20, 108, 67), Typeface.BOLD), wrapWrap().apply { topMargin = dp(92) })
        root.addView(label("设备关联成功", 28f, ink, Typeface.BOLD), wrapWrap().apply { topMargin = dp(16) })
        root.addView(label("设备已进入待授权状态。", 15f, secondary), wrapWrap().apply { topMargin = dp(9) })
        root.addView(label("后续仍需完成平台授权与接入检查。", 14f, secondary), wrapWrap().apply { topMargin = dp(16) })
        root.addView(primaryButton("返回设备管理").apply { setOnClickListener { showManagement(session) } }, matchHeight(54).apply { topMargin = dp(28) })
        setContentView(root)
    }

    private fun renderDevices(container: LinearLayout, devices: List<ProviderDevice>) {
        container.removeAllViews()
        if (devices.isEmpty()) {
            container.addView(label("还没有关联的执行手机。", 14f, secondary), matchWrap().apply { topMargin = dp(12) })
            return
        }
        devices.forEach { device ->
            val card = vertical(16).apply { background = rounded(Color.WHITE, 12) }
            card.addView(label(device.displayName, 17f, ink, Typeface.BOLD))
            card.addView(label(localizedDeviceState(device.state), 13f, secondary), matchWrap().apply { topMargin = dp(7) })
            container.addView(card, matchWrap().apply { topMargin = dp(12) })
        }
    }

    private fun renderDeviceError(container: LinearLayout, message: String) {
        container.removeAllViews()
        container.addView(label(message, 14f, danger), matchWrap().apply { topMargin = dp(12) })
    }

    private fun appHeader(title: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(label("SocialGrowth", 19f, ink, Typeface.BOLD), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        addView(label(title, 14f, secondary), wrapWrap())
    }

    private fun backHeader(title: String, onBack: () -> Unit) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(ImageButton(this@MainActivity).apply {
            val up = TypedValue()
            if (theme.resolveAttribute(android.R.attr.homeAsUpIndicator, up, true)) {
                setImageResource(up.resourceId)
            } else {
                setImageResource(android.R.drawable.ic_menu_revert)
            }
            setColorFilter(ink)
            background = null
            contentDescription = "返回"
            setOnClickListener { onBack() }
        }, LinearLayout.LayoutParams(dp(48), dp(48)))
        if (title.isNotEmpty()) {
            addView(label(title, 17f, ink, Typeface.BOLD), wrapWrap().apply { marginStart = dp(4) })
        }
    }

    private fun stepRow(number: String, value: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(label(number, 15f, Color.WHITE, Typeface.BOLD).apply {
            gravity = Gravity.CENTER
            background = rounded(blue, 18)
        }, LinearLayout.LayoutParams(dp(34), dp(34)))
        addView(label(value, 14f, ink), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(12) })
    }

    private fun detailRow(key: String, value: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        addView(label(key, 14f, secondary), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        addView(label(value, 14f, ink, Typeface.BOLD), wrapWrap())
    }

    private fun explanationRow(number: String, value: String) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        addView(label(number, 13f, blue, Typeface.BOLD).apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(dp(28), dp(28)))
        addView(label(value, 14f, ink), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(8) })
    }

    private fun qrBitmap(payload: String): Bitmap = BarcodeEncoder().encodeBitmap(
        payload,
        BarcodeFormat.QR_CODE,
        720,
        720,
    )

    private fun shortDeviceName(): String = Build.MODEL.take(24).ifBlank { "Android" }
    private fun executionDeviceLabel(): String = "执行手机 ${shortDeviceName()}".take(100)
    private fun formatExpiry(value: String): String = DateTimeFormatter.ofPattern("HH:mm")
        .withZone(ZoneId.systemDefault())
        .format(displayInstant(value))
    private fun displayInstant(value: String): Instant = Instant.parse(
        value.replace(Regex("(\\.\\d{9})\\d+(?=Z|[+-]\\d{2}:\\d{2}$)"), "$1"),
    )
    private fun localizedDeviceState(value: String): String = when (value) {
        "associated_pending_access" -> "已关联 · 待授权"
        "access_ready" -> "已就绪"
        "paused" -> "已暂停"
        "exit_pending" -> "退出处理中"
        "exited" -> "已退出"
        else -> "未关联"
    }

    private fun ProviderAuthResult.toStored() = StoredProviderSession(
        provider.providerId.toString(),
        provider.displayName,
        provider.phoneHint,
        sessionToken,
        session.expiresAt,
    )

    private fun setStatus(container: LinearLayout, title: String, detail: String, isError: Boolean) {
        container.removeAllViews()
        container.addView(label(title, 15f, if (isError) danger else Color.rgb(20, 108, 67), Typeface.BOLD))
        container.addView(label(detail, 13f, secondary), matchWrap().apply { topMargin = dp(4) })
    }

    private fun <T> runNetwork(action: () -> T, success: (T) -> Unit, failure: (String) -> Unit) {
        executor.execute {
            try {
                val result = action()
                mainHandler.post { success(result) }
            } catch (error: ProviderApiException) {
                mainHandler.post { failure(error.message) }
            } catch (_: Exception) {
                mainHandler.post { failure("无法连接服务，请检查网络后重试。") }
            }
        }
    }

    private fun setBusy(busy: Boolean, requestCode: Button, submit: Button, error: TextView, card: LinearLayout) {
        requestCode.isEnabled = !busy && (!registrationMode || invitationCode != null) && challenge == null
        submit.isEnabled = !busy
        card.alpha = if (busy) 0.72f else 1f
        if (busy) error.visibility = View.GONE
    }

    private fun showError(view: TextView, message: String) {
        view.text = message
        view.visibility = View.VISIBLE
    }

    private fun resetAttemptKeys() {
        challengeKey = newIdempotencyKey("challenge")
        verifyKey = newIdempotencyKey("verify")
        authKey = newIdempotencyKey("auth")
        lastCode = ""
    }

    private fun newIdempotencyKey(prefix: String) = "$prefix-${UUID.randomUUID()}"
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun vertical(padding: Int) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(padding), dp(padding), dp(padding), dp(padding))
    }
    private fun label(value: String, size: Float, color: Int, style: Int = Typeface.NORMAL) = TextView(this).apply {
        text = value
        textSize = size
        setTextColor(color)
        setTypeface(typeface, style)
        setLineSpacing(0f, 1.12f)
    }
    private fun fieldLabel(value: String) = label(value, 14f, ink, Typeface.BOLD)
    private fun editText(hintValue: String, type: Int) = EditText(this).apply {
        hint = hintValue
        textSize = 16f
        setTextColor(ink)
        setHintTextColor(Color.rgb(136, 148, 164))
        inputType = type
        setSingleLine(true)
        setPadding(dp(14), 0, dp(14), 0)
        background = outlined(Color.WHITE)
    }
    private fun primaryButton(value: String) = Button(this).apply {
        text = value
        textSize = 16f
        setTextColor(Color.WHITE)
        setTypeface(typeface, Typeface.BOLD)
        isAllCaps = false
        background = rounded(blue, 9)
    }
    private fun secondaryButton(value: String) = Button(this).apply {
        text = value
        textSize = 14f
        setTextColor(blue)
        isAllCaps = false
        background = outlined(Color.WHITE)
    }
    private fun divider() = View(this).apply { setBackgroundColor(dividerColor) }
    private fun outlined(fill: Int) = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(fill)
        setStroke(dp(1), dividerColor)
        cornerRadius = dp(9).toFloat()
    }
    private fun rounded(color: Int, radius: Int) = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        setColor(color)
        cornerRadius = dp(radius).toFloat()
    }
    private fun matchWrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    private fun wrapWrap() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    private fun matchHeight(height: Int) = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(height))
}
