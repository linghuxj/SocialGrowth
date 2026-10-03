package com.socialgrowth.product

import android.graphics.Bitmap
import android.content.Intent
import androidx.core.content.ContextCompat
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
import androidx.activity.OnBackPressedCallback
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
    private var backAction: (() -> Unit)? = null
    private var managementSessionToken: String? = null
    private var pendingScanGeneration: Int? = null
    private var associationConfirmKey = newIdempotencyKey("association-confirm")
    private val barcodeLauncher = registerForActivityResult(ScanContract()) { result ->
        if (pendingScanGeneration != screenGeneration) {
            if (result.contents != null) {
                Toast.makeText(this, "扫码页面已重建，请重新扫码核对设备。", Toast.LENGTH_LONG).show()
            }
            return@registerForActivityResult
        }
        pendingScanGeneration = null
        result.contents?.let(::handleAssociationPayload)
            ?: sessionStore.load()?.let(::showManagement)
            ?: showAuthForm()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                backAction?.invoke() ?: finish()
            }
        })
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
            if (savedInstanceState?.getBoolean("pendingAssociationScan") == true) {
                pendingScanGeneration = screenGeneration
            }
            return
        }
        showAuthForm()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("pendingAssociationScan", pendingScanGeneration != null)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        ++screenGeneration
        pendingScanGeneration = null
        mainHandler.removeCallbacksAndMessages(null)
        executor.shutdownNow()
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        if (!::sessionStore.isInitialized) return
        val current = sessionStore.load()
        val token = managementSessionToken
        if (token != null && current?.sessionToken != token) {
            current?.let(::showManagement) ?: showAuthForm()
        } else if (token == null && current != null && ::installationStore.isInitialized && !installationStore.exists()) {
            showManagement(current)
        }
    }

    private fun showAuthForm() {
        ++screenGeneration
        backAction = null
        managementSessionToken = null
        pendingScanGeneration = null
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
            val requestedRegistration = registrationMode
            val requestedInvitation = invitationCode
            val requestedChallengeKey = challengeKey
            val generation = screenGeneration
            if (!phoneValue.matches(Regex("^\\+[1-9][0-9]{7,14}$"))) {
                showError(error, "请输入带国际区号的完整手机号，例如以 + 开头。")
                return@setOnClickListener
            }
            setBusy(true, requestCode, submit, error, card)
            runNetwork(
                action = {
                    api.requestVerification(
                        phoneValue,
                        if (requestedRegistration) "provider_registration" else "provider_login",
                        requestedInvitation,
                        requestedChallengeKey,
                    )
                },
                success = { result ->
                    if (generation != screenGeneration) return@runNetwork
                    challenge = result
                    requestCode.text = "验证码已受理"
                    setStatus(status, if (requestedRegistration) "邀请已校验" else "账号已确认", "请填写验证码继续。", false)
                    setBusy(false, requestCode, submit, error, card)
                    requestCode.isEnabled = false
                },
                failure = { message ->
                    if (generation != screenGeneration) return@runNetwork
                    showError(error, message)
                    setBusy(false, requestCode, submit, error, card)
                },
            )
        }

        submit.setOnClickListener {
            val activeChallenge = challenge
            val requestedRegistration = registrationMode
            val requestedInvitation = invitationCode
            val generation = screenGeneration
            val expectedStoredToken = sessionStore.load()?.sessionToken
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
            val requestedVerifyKey = verifyKey
            val requestedAuthKey = authKey
            setBusy(true, requestCode, submit, error, card)
            runNetwork(
                action = {
                    val proof = api.verifyCode(activeChallenge.challengeId, codeValue, requestedVerifyKey)
                    if (requestedRegistration) api.register(requestedInvitation!!, proof.phoneVerificationId, requestedAuthKey)
                    else api.login(proof.phoneVerificationId, requestedAuthKey)
                },
                success = { auth ->
                    if (generation != screenGeneration) return@runNetwork
                    try {
                        if (sessionStore.saveIfCurrentMatches(auth, expectedStoredToken)) {
                            showManagement(auth.toStored())
                        } else {
                            sessionStore.load()?.let(::showManagement) ?: showAuthForm()
                        }
                    } catch (_: Exception) {
                        showError(error, "无法安全保存登录状态，请重试。")
                        setBusy(false, requestCode, submit, error, card)
                    }
                },
                failure = { message ->
                    if (generation != screenGeneration) return@runNetwork
                    showError(error, message)
                    setBusy(false, requestCode, submit, error, card)
                },
            )
        }
        setContentView(scroll)
    }

    private fun showManagement(session: StoredProviderSession) {
        val generation = ++screenGeneration
        backAction = null
        managementSessionToken = session.sessionToken
        pendingScanGeneration = null
        val content = vertical(20).apply { setBackgroundColor(canvas) }
        content.addView(appHeader("仅管理"), matchWrap())
        val titleRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        titleRow.addView(label("我的设备", 30f, ink, Typeface.BOLD), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        val profile = secondaryButton("我的").apply {
            id = R.id.provider_profile
            contentDescription = "查看我的身份与登录帮助"
            isEnabled = false
            setOnClickListener { showProviderProfile(session) }
        }
        titleRow.addView(profile, LinearLayout.LayoutParams(dp(88), dp(48)))
        content.addView(titleRow, matchWrap().apply { topMargin = dp(22) })
        val identity = label("正在验证管理身份…", 14f, secondary)
        content.addView(identity, matchWrap().apply { topMargin = dp(7) })
        val summary = label("正在读取本人设备…", 14f, secondary)
        content.addView(summary, matchWrap().apply { topMargin = dp(12) })
        val add = primaryButton("添加执行手机").apply {
            id = R.id.provider_add_device
            contentDescription = "扫码添加执行手机"
            isEnabled = false
            setOnClickListener { startAssociationScan() }
        }
        content.addView(add, matchHeight(54).apply { topMargin = dp(22) })
        content.addView(label("扫码只用于核对设备；确认前不会建立归属。", 13f, secondary).apply {
            gravity = Gravity.CENTER
        }, matchWrap().apply { topMargin = dp(9) })
        val listHeading = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        listHeading.addView(label("当前归属设备", 18f, ink, Typeface.BOLD), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        listHeading.addView(secondaryButton("刷新").apply {
            id = R.id.provider_device_refresh
            setOnClickListener { showManagement(session) }
        }, LinearLayout.LayoutParams(dp(88), dp(48)))
        content.addView(listHeading, matchWrap().apply { topMargin = dp(22) })
        val devices = vertical(0).apply { id = R.id.provider_device_list }
        devices.addView(label("正在读取设备…", 14f, secondary), matchWrap().apply { topMargin = dp(12) })
        content.addView(devices, matchWrap())
        content.addView(label(DeviceFactPresentation.ACCESS_BOUNDARY, 13f, secondary), matchWrap().apply { topMargin = dp(14) })
        val logout = secondaryButton("退出管理登录").apply {
            id = R.id.provider_logout
            setOnClickListener { logoutManagement(session, this) }
        }
        content.addView(logout, matchHeight(54).apply { topMargin = dp(30) })
        content.addView(label("退出管理登录只撤销此管理会话，不暂停或退出已关联的执行手机。", 13f, secondary), matchWrap().apply { topMargin = dp(8) })
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(content, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        setContentView(scroll)
        guardManagementExpiry(session, generation)
        readProviderDevices(session, generation,
            success = { list ->
                identity.text = "${session.displayName} · ${session.phoneHint}"
                profile.isEnabled = true
                add.isEnabled = true
                summary.text = "${list.size} 台当前归属设备 · 连接状态未确认"
                renderDevices(devices, list, session)
            },
            failure = { message ->
                identity.text = "身份尚未确认"
                summary.text = "设备读取失败"
                renderDeviceError(devices, message, session)
            },
        )
    }

    private fun showInstallationLoading(refreshSession: Boolean = false) {
        val generation = ++screenGeneration
        backAction = null
        managementSessionToken = null
        pendingScanGeneration = null
        val root = vertical(20).apply {
            setBackgroundColor(canvas)
            gravity = Gravity.CENTER_HORIZONTAL
        }
        root.addView(label("正在准备本机安全身份…", 18f, ink, Typeface.BOLD), wrapWrap().apply { topMargin = dp(160) })
        root.addView(label("根凭据只保存在本机安全存储中。", 14f, secondary), wrapWrap().apply { topMargin = dp(12) })
        setContentView(root)
        executor.execute {
            var loadStage = "credential"
            try {
                var stored = installationStore.ensureCredential()
                loadStage = "session"
                var token = stored.activeSessionToken()
                if (token == null || refreshSession) {
                    loadStage = "bootstrap"
                    val auth = associationApi.bootstrap(stored.credential, newIdempotencyKey("installation-bootstrap"))
                    stored = installationStore.saveAuth(stored, auth)
                    token = stored.activeSessionToken() ?: error("inactive installation session")
                }
                loadStage = "state_request"
                val state = associationApi.installationState(token)
                loadStage = "state_presentation"
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
                mainHandler.post { if (generation == screenGeneration) showInstallationFailure(error.message, error.code == "AUTHENTICATION_REQUIRED") }
            } catch (error: Exception) {
                if (BuildConfig.ENDPOINT_DIAGNOSTICS) android.util.Log.d("SGEndpointDiagnostic", "installation_load_failed stage=$loadStage cause=${error.javaClass.simpleName}")
                mainHandler.post { if (generation == screenGeneration) showInstallationFailure("无法连接服务，请检查网络后重试。") }
            }
        }
    }

    private fun showInstallationCode(
        identity: StoredInstallationIdentity,
        association: AssociationSession,
    ) {
        val generation = ++screenGeneration
        backAction = { showInstallationGuide(identity, association) }
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
        backAction = { showInstallationCode(identity, association) }
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
        backAction = null
        val root = vertical(24).apply {
            setBackgroundColor(canvas)
            gravity = Gravity.CENTER_HORIZONTAL
        }
        root.addView(label("本机设备事实", 28f, ink, Typeface.BOLD), wrapWrap().apply { topMargin = dp(80) })
        root.addView(label("本机 ${shortDeviceName()}", 16f, secondary), wrapWrap().apply { topMargin = dp(8) })
        root.addView(label("仅显示这台执行手机的当前事实。", 14f, secondary).apply {
            gravity = Gravity.CENTER
        }, matchWrap().apply { topMargin = dp(12) })
        val facts = vertical(16).apply { background = rounded(Color.WHITE, 12) }
        facts.addView(detailRow("关联状态", DeviceFactPresentation.state(state.state)))
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        facts.addView(detailRow("连接确认", DeviceFactPresentation.CONNECTION_UNKNOWN))
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        facts.addView(detailRow("事实更新时间", formatFactTime(state.updatedAt)))
        val networkFact = label("网络核验状态读取中", 14f, secondary)
        facts.addView(networkFact, matchWrap().apply { topMargin = dp(14) })
        val factScreen = screenGeneration
        runNetwork(action = {
            val identity = installationStore.load() ?: error("Missing installation")
            val token = identity.activeSessionToken() ?: error("Inactive installation")
            val installation = UUID.fromString(identity.installationId)
            NetworkAdmissionStateClient(api).state(token, installation, requireNotNull(identity.generation).toString()).also {
                require(it.scope.deviceId == state.deviceId && it.scope.ownershipVersion == state.factVersion.toString())
            }
        }, success = { fact ->
            if (factScreen == screenGeneration) networkFact.text = if (fact.verifierReady) "网络核验可用；当前接入许可仍待独立确认" else "网络核验尚未就绪"
        }, failure = {
            if (factScreen == screenGeneration) networkFact.text = "网络核验状态暂时无法读取"
        })
        root.addView(facts, matchWrap().apply { topMargin = dp(24) })
        root.addView(label(DeviceFactPresentation.ACCESS_BOUNDARY, 14f, secondary).apply {
            gravity = Gravity.CENTER
        }, matchWrap().apply { topMargin = dp(18) })
        root.addView(secondaryButton("刷新状态").apply { setOnClickListener { showInstallationLoading() } }, matchHeight(54).apply { topMargin = dp(28) })
        root.addView(label("本机参与确认单独开启；接入、控制权及每次动作仍由系统核验。撤回不会被当成手机已停止。", 14f, secondary), matchWrap().apply { topMargin = dp(16) })
        if (BuildConfig.ENDPOINT_DIAGNOSTICS) {
            val endpointStatus = label(EndpointReportingService.statusText(), 14f, secondary)
            root.addView(endpointStatus, matchWrap().apply { topMargin = dp(12) })
            val endpointScreen = screenGeneration
            fun refreshEndpointStatus() {
                if (endpointScreen != screenGeneration || isDestroyed || isFinishing) return
                endpointStatus.text = EndpointReportingService.statusText()
                mainHandler.postDelayed({ refreshEndpointStatus() }, 500)
            }
            refreshEndpointStatus()
            root.addView(secondaryButton("开启端口自动上报").apply {
                isEnabled = Build.VERSION.SDK_INT >= 34 && state.state in setOf("associated_pending_access", "access_ready")
                setOnClickListener {
                    try { ContextCompat.startForegroundService(this@MainActivity, Intent(this@MainActivity, EndpointReportingService::class.java).setAction(EndpointReportingService.START)) }
                    catch (_: Exception) { Toast.makeText(this@MainActivity, "端口上报服务未能启动", Toast.LENGTH_LONG).show() }
                }
            }, matchHeight(54).apply { topMargin = dp(8) })
            root.addView(secondaryButton("停止端口自动上报").apply {
                setOnClickListener { if (EndpointReportingService.running) startService(Intent(this@MainActivity, EndpointReportingService::class.java).setAction(EndpointReportingService.STOP)) }
            }, matchHeight(54).apply { topMargin = dp(8) })
        }
        val participationStatus=label(ParticipationService.statusText(),14f,secondary)
        root.addView(participationStatus,matchWrap().apply { topMargin=dp(8) })
        val participationScreen=screenGeneration
        fun refreshParticipationStatus() {
            if(participationScreen!=screenGeneration || isDestroyed || isFinishing) return
            participationStatus.text=ParticipationService.statusText()
            mainHandler.postDelayed({ refreshParticipationStatus() },500)
        }
        refreshParticipationStatus()
        root.addView(primaryButton("确认当前参与").apply {
            isEnabled = state.state in setOf("associated_pending_access", "access_ready")
            setOnClickListener {
                try {
                    ContextCompat.startForegroundService(this@MainActivity, Intent(this@MainActivity, ParticipationService::class.java).setAction(ParticipationService.START))
                    Toast.makeText(this@MainActivity, "参与确认请求已提交；以本机状态显示为准。", Toast.LENGTH_LONG).show()
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "本机参与服务未能启动，请检查客户端系统设置。", Toast.LENGTH_LONG).show()
                }
            }
        }, matchHeight(54).apply { topMargin = dp(12) })
        root.addView(secondaryButton("撤回本机参与").apply {
            setOnClickListener {
                if (ParticipationService.running) startService(Intent(this@MainActivity, ParticipationService::class.java).setAction(ParticipationService.STOP))
                Toast.makeText(this@MainActivity, "已停止本机后续参与确认；等待中心撤权和实际停止核实。", Toast.LENGTH_LONG).show()
            }
        }, matchHeight(54).apply { topMargin = dp(8) })
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        })
    }

    private fun showInstallationFailure(message: String, sessionRejected: Boolean = false) {
        ++screenGeneration
        backAction = null
        val root = vertical(24).apply {
            setBackgroundColor(canvas)
            gravity = Gravity.CENTER_HORIZONTAL
        }
        root.addView(label("暂时无法准备关联码", 24f, ink, Typeface.BOLD), wrapWrap().apply { topMargin = dp(120) })
        root.addView(label(message, 14f, danger).apply { gravity = Gravity.CENTER }, matchWrap().apply { topMargin = dp(14) })
        root.addView(primaryButton("重试").apply { setOnClickListener { showInstallationLoading() } }, matchHeight(54).apply { topMargin = dp(24) })
        if (sessionRejected) {
            root.addView(label("本机会话已失效。可使用原本机安全身份重新验证；不会自动认领旧设备、解除暂停或恢复参与。", 14f, secondary), matchWrap().apply { topMargin = dp(16) })
            root.addView(secondaryButton("重新验证本机身份").apply {
                setOnClickListener { showInstallationLoading(refreshSession = true) }
            }, matchHeight(54).apply { topMargin = dp(12) })
        }
        setContentView(root)
    }

    private fun startAssociationScan() {
        val session = sessionStore.load()
        if (session == null) {
            showAuthForm()
            return
        }
        pendingScanGeneration = ++screenGeneration
        backAction = { showManagement(session) }
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
            showManagement(session)
            Toast.makeText(this, "这不是有效的 SocialGrowth 设备关联码。", Toast.LENGTH_LONG).show()
            return
        }
        val generation = ++screenGeneration
        backAction = { showManagement(session) }
        val loading = vertical(24).apply {
            setBackgroundColor(canvas)
            gravity = Gravity.CENTER_HORIZONTAL
            addView(label("正在安全核对设备…", 18f, ink, Typeface.BOLD), wrapWrap().apply { topMargin = dp(160) })
        }
        setContentView(loading)
        guardManagementExpiry(session, generation)
        runManagementNetwork(session, generation,
            action = { associationApi.inspect(session.sessionToken, qr.associationCode) },
            success = { showAssociationConfirmation(session, it) },
            failure = { message ->
                Toast.makeText(this, message, Toast.LENGTH_LONG).show()
                showManagement(session)
            },
        )
    }

    private fun showAssociationConfirmation(
        session: StoredProviderSession,
        inspection: AssociationInspection,
    ) {
        val generation = ++screenGeneration
        var confirmationSubmitted = false
        val leaveConfirmation = {
            if (confirmationSubmitted) {
                Toast.makeText(this, "确认请求可能仍在处理中，请在设备页刷新核对最终归属。", Toast.LENGTH_LONG).show()
            }
            showManagement(session)
        }
        backAction = leaveConfirmation
        associationConfirmKey = newIdempotencyKey("association-confirm")
        val root = vertical(20).apply { setBackgroundColor(canvas) }
        root.addView(backHeader("添加执行手机", leaveConfirmation), matchWrap())
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
                confirmationSubmitted = true
                error.visibility = View.GONE
                runManagementNetwork(session, generation,
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
            setOnClickListener {
                if (confirmationSubmitted) {
                    Toast.makeText(this@MainActivity, "上次确认可能仍在处理中，稍后到设备页刷新核对。", Toast.LENGTH_LONG).show()
                }
                startAssociationScan()
            }
        }, matchHeight(52).apply { topMargin = dp(10) })
        root.addView(label("关联不会把当前管理手机接入执行。", 13f, secondary).apply {
            gravity = Gravity.CENTER
        }, matchWrap().apply { topMargin = dp(13) })
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        setContentView(scroll)
        guardManagementExpiry(session, generation)
    }

    private fun showAssociationSuccess(session: StoredProviderSession, receipt: AssociationReceipt) {
        val generation = ++screenGeneration
        backAction = { showManagement(session) }
        val root = vertical(24).apply { setBackgroundColor(canvas); gravity = Gravity.CENTER_HORIZONTAL }
        root.addView(label("✓", 54f, Color.rgb(20, 108, 67), Typeface.BOLD), wrapWrap().apply { topMargin = dp(92) })
        root.addView(label("设备关联成功", 28f, ink, Typeface.BOLD), wrapWrap().apply { topMargin = dp(16) })
        root.addView(label("设备已进入待授权状态。", 15f, secondary), wrapWrap().apply { topMargin = dp(9) })
        root.addView(label("后续仍需完成平台授权与接入检查。", 14f, secondary), wrapWrap().apply { topMargin = dp(16) })
        root.addView(primaryButton("返回设备管理").apply { setOnClickListener { showManagement(session) } }, matchHeight(54).apply { topMargin = dp(28) })
        setContentView(root)
        guardManagementExpiry(session, generation)
    }

    private fun renderDevices(container: LinearLayout, devices: List<ProviderDevice>, session: StoredProviderSession) {
        container.removeAllViews()
        if (devices.isEmpty()) {
            container.addView(label("还没有关联的执行手机。", 14f, secondary), matchWrap().apply { topMargin = dp(12) })
            return
        }
        devices.forEach { device ->
            val row = vertical(16).apply {
                background = rounded(Color.WHITE, 12)
                minimumHeight = dp(96)
                isClickable = true
                isFocusable = true
                contentDescription = "查看${device.displayName}详情，${DeviceFactPresentation.state(device.state)}"
                setOnClickListener { showProviderDeviceDetail(session, device.deviceId) }
            }
            row.addView(label(device.displayName, 18f, ink, Typeface.BOLD))
            row.addView(label(DeviceFactPresentation.state(device.state), 14f, secondary), matchWrap().apply { topMargin = dp(7) })
            row.addView(label(DeviceFactPresentation.observation(device.lastObservedAt), 12f, secondary), matchWrap().apply { topMargin = dp(5) })
            container.addView(row, matchWrap().apply { topMargin = dp(10) })
        }
    }

    private fun renderDeviceError(container: LinearLayout, message: String, session: StoredProviderSession) {
        container.removeAllViews()
        container.addView(label(message, 14f, danger), matchWrap().apply { topMargin = dp(12) })
        container.addView(secondaryButton("重试读取").apply {
            setOnClickListener { showManagement(session) }
        }, matchHeight(52).apply { topMargin = dp(12) })
    }

    private fun showProviderDeviceDetail(session: StoredProviderSession, deviceId: UUID) {
        val generation = ++screenGeneration
        backAction = { showManagement(session) }
        val root = vertical(20).apply { setBackgroundColor(canvas) }
        root.addView(backHeader("设备详情") { showManagement(session) }, matchWrap())
        val detail = vertical(0).apply { id = R.id.provider_device_detail }
        detail.addView(label("正在读取当前设备事实…", 15f, secondary), matchWrap().apply { topMargin = dp(24) })
        root.addView(detail, matchWrap())
        root.addView(secondaryButton("刷新设备事实").apply {
            setOnClickListener { showProviderDeviceDetail(session, deviceId) }
        }, matchHeight(52).apply { topMargin = dp(20) })
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        setContentView(scroll)
        guardManagementExpiry(session, generation)
        readProviderDevices(session, generation,
            success = { list ->
                val current = list.find { it.deviceId == deviceId }
                detail.removeAllViews()
                if (current == null) {
                    detail.addView(label("这台手机已不在你的当前归属清单中。", 15f, secondary), matchWrap().apply { topMargin = dp(24) })
                } else renderProviderDeviceDetail(detail, current)
            },
            failure = { message ->
                detail.removeAllViews()
                detail.addView(label(message, 14f, danger), matchWrap().apply { topMargin = dp(24) })
            },
        )
    }

    private fun renderProviderDeviceDetail(container: LinearLayout, device: ProviderDevice) {
        container.addView(label(device.displayName, 30f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(20) })
        container.addView(label("专用执行手机 · ${DeviceFactPresentation.state(device.state)}", 15f, secondary), matchWrap().apply { topMargin = dp(6) })
        val facts = vertical(16).apply { background = rounded(Color.WHITE, 12) }
        facts.addView(label("当前事实", 18f, ink, Typeface.BOLD))
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        facts.addView(detailRow("归属状态", DeviceFactPresentation.state(device.state)))
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        facts.addView(detailRow("连接确认", DeviceFactPresentation.CONNECTION_UNKNOWN))
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        facts.addView(detailRow("最近观察", if (device.lastObservedAt == null) "暂无" else formatFactTime(device.lastObservedAt)))
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        facts.addView(detailRow("事实更新时间", formatFactTime(device.updatedAt)))
        container.addView(facts, matchWrap().apply { topMargin = dp(20) })
        container.addView(label(DeviceFactPresentation.ACCESS_BOUNDARY, 14f, secondary), matchWrap().apply { topMargin = dp(18) })
        container.addView(label("查看详情不会申请控制，也不会改变手机状态。当前没有权威项目、发布身份或平台授权资料。", 13f, secondary), matchWrap().apply { topMargin = dp(10) })
    }

    private fun showProviderProfile(session: StoredProviderSession) {
        val generation = ++screenGeneration
        backAction = { showManagement(session) }
        val root = vertical(20).apply { setBackgroundColor(canvas) }
        root.addView(backHeader("我的") { showManagement(session) }, matchWrap())
        root.addView(label("我的", 30f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(22) })
        root.addView(label("管理本人身份与登录", 15f, secondary), matchWrap().apply { topMargin = dp(6) })
        val identity = vertical(16).apply { background = rounded(Color.WHITE, 12) }
        identity.addView(label(session.displayName, 22f, ink, Typeface.BOLD))
        identity.addView(label("登录手机号 ${session.phoneHint}", 15f, secondary), matchWrap().apply { topMargin = dp(10) })
        identity.addView(divider(), matchHeight(1).apply { topMargin = dp(18); bottomMargin = dp(18) })
        identity.addView(detailRow("当前使用方式", "仅管理"))
        identity.addView(label("执行手机请到“设备”页逐台查看。", 13f, secondary), matchWrap().apply { topMargin = dp(14) })
        root.addView(identity, matchWrap().apply { topMargin = dp(24) })
        root.addView(secondaryButton("账号与登录帮助").apply {
            id = R.id.provider_account_help
            setOnClickListener { showAccountHelp(session) }
        }, matchHeight(54).apply { topMargin = dp(18) })
        root.addView(secondaryButton("设备接入说明").apply {
            id = R.id.provider_association_help
            setOnClickListener { showManagementAssociationGuide(session) }
        }, matchHeight(54).apply { topMargin = dp(10) })
        root.addView(secondaryButton("返回我的设备").apply {
            setOnClickListener { showManagement(session) }
        }, matchHeight(52).apply { topMargin = dp(10) })
        root.addView(secondaryButton("退出管理登录").apply {
            setOnClickListener { logoutManagement(session, this) }
        }, matchHeight(54).apply { topMargin = dp(30) })
        root.addView(label("退出管理登录不暂停或退出任何已关联执行手机。", 13f, secondary), matchWrap().apply { topMargin = dp(8) })
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        })
        guardManagementExpiry(session, generation)
    }

    private fun showAccountHelp(session: StoredProviderSession) {
        val generation = ++screenGeneration
        backAction = { showProviderProfile(session) }
        val root = vertical(20).apply { setBackgroundColor(canvas) }
        root.addView(backHeader("账号与登录帮助") { showProviderProfile(session) }, matchWrap())
        root.addView(label("原手机号不可用", 29f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(22) })
        root.addView(label("联系原邀请运营，人工核验后再更换登录号码。", 15f, secondary), matchWrap().apply { topMargin = dp(7) })
        val card = vertical(16).apply { background = rounded(Color.WHITE, 12) }
        card.addView(label("先联系邀请你的运营", 18f, ink, Typeface.BOLD))
        card.addView(label("请通过你们原有的联系渠道说明情况；这里不会自动发送消息或提交申请。", 14f, secondary), matchWrap().apply { topMargin = dp(8) })
        card.addView(divider(), matchHeight(1).apply { topMargin = dp(18); bottomMargin = dp(18) })
        card.addView(label("1. 运营人工核验原提供者身份", 14f, ink))
        card.addView(label("2. 核验通过后验证新手机号", 14f, ink), matchWrap().apply { topMargin = dp(14) })
        card.addView(label("3. 受控换绑回原身份，保留设备与分佣历史", 14f, ink), matchWrap().apply { topMargin = dp(14) })
        root.addView(card, matchWrap().apply { topMargin = dp(24) })
        root.addView(label("仅验证新号码不能直接取得旧账号；不要重新注册或重复关联设备。当前 App 不办理换绑，实际操作须由运营在核验及记录后完成。", 13f, secondary), matchWrap().apply { topMargin = dp(18) })
        root.addView(secondaryButton("返回我的").apply {
            setOnClickListener { showProviderProfile(session) }
        }, matchHeight(52).apply { topMargin = dp(28) })
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        })
        guardManagementExpiry(session, generation)
    }

    private fun showManagementAssociationGuide(session: StoredProviderSession) {
        val generation = ++screenGeneration
        backAction = { showProviderProfile(session) }
        val root = vertical(20).apply { setBackgroundColor(canvas) }
        root.addView(backHeader("设备接入说明") { showProviderProfile(session) }, matchWrap())
        root.addView(label("逐台接入执行手机", 29f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(22) })
        root.addView(label("管理手机只用于核对，不会因扫码变成执行手机。", 15f, secondary), matchWrap().apply { topMargin = dp(7) })
        val steps = vertical(16).apply { background = rounded(Color.WHITE, 12) }
        steps.addView(label("1. 在独立执行手机上打开接入码", 15f, ink))
        steps.addView(label("2. 用管理手机扫描并核对目标设备", 15f, ink), matchWrap().apply { topMargin = dp(14) })
        steps.addView(label("3. 明确确认后再查看本人设备列表", 15f, ink), matchWrap().apply { topMargin = dp(14) })
        root.addView(steps, matchWrap().apply { topMargin = dp(24) })
        root.addView(label("关联成功只表示进入待完成接入状态；平台授权、连接确认和可接任务仍须另行验证。不要用同一台管理手机替代独立执行手机。", 14f, secondary), matchWrap().apply { topMargin = dp(18) })
        root.addView(secondaryButton("返回我的").apply {
            setOnClickListener { showProviderProfile(session) }
        }, matchHeight(52).apply { topMargin = dp(28) })
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        })
        guardManagementExpiry(session, generation)
    }

    private fun logoutManagement(session: StoredProviderSession, button: Button) {
        button.isEnabled = false
        button.text = "正在退出…"
        runNetwork(
            action = { api.logout(session.sessionToken, newIdempotencyKey("logout")); true },
            success = {
                sessionStore.clearIfTokenMatches(session.sessionToken)
                resetAttemptKeys()
                sessionStore.load()?.let(::showManagement) ?: showAuthForm()
            },
            failure = { message ->
                button.isEnabled = true
                button.text = "退出管理登录"
                Toast.makeText(this, message, Toast.LENGTH_LONG).show()
            },
        )
    }

    private fun readProviderDevices(
        session: StoredProviderSession,
        generation: Int,
        success: (List<ProviderDevice>) -> Unit,
        failure: (String) -> Unit,
    ) {
        executor.execute {
            try {
                val devices = associationApi.devices(session.sessionToken)
                mainHandler.post {
                    if (generation == screenGeneration && managementSessionValid(session)) success(devices)
                }
            } catch (error: ProviderApiException) {
                mainHandler.post {
                    if (generation != screenGeneration) return@post
                    if (error.code == "AUTHENTICATION_REQUIRED" || error.code == "PROVIDER_DISABLED") {
                        rejectManagementSession(session, error.message)
                    } else if (managementSessionValid(session)) failure(error.message)
                }
            } catch (_: Exception) {
                mainHandler.post {
                    if (generation == screenGeneration && managementSessionValid(session)) {
                        failure("无法连接服务，请检查网络后重试。")
                    }
                }
            }
        }
    }

    private fun <T> runManagementNetwork(
        session: StoredProviderSession,
        generation: Int,
        action: () -> T,
        success: (T) -> Unit,
        failure: (String) -> Unit,
    ) {
        executor.execute {
            try {
                val result = action()
                mainHandler.post {
                    if (generation != screenGeneration || !managementSessionValid(session)) return@post
                    success(result)
                }
            } catch (error: ProviderApiException) {
                mainHandler.post {
                    if (generation != screenGeneration) return@post
                    if (error.code == "AUTHENTICATION_REQUIRED" || error.code == "PROVIDER_DISABLED") {
                        rejectManagementSession(session, error.message)
                    } else if (managementSessionValid(session)) failure(error.message)
                }
            } catch (_: Exception) {
                mainHandler.post {
                    if (generation == screenGeneration && managementSessionValid(session)) {
                        failure("无法连接服务，请检查网络后重试。")
                    }
                }
            }
        }
    }

    private fun managementSessionValid(session: StoredProviderSession): Boolean {
        val current = sessionStore.load()
        if (current?.sessionToken == session.sessionToken) return true
        current?.let(::showManagement) ?: showAuthForm()
        return false
    }

    private fun rejectManagementSession(session: StoredProviderSession, message: String) {
        sessionStore.clearIfTokenMatches(session.sessionToken)
        val current = sessionStore.load()
        if (current == null) {
            showAuthForm()
            Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        } else {
            showManagement(current)
        }
    }

    private fun guardManagementExpiry(session: StoredProviderSession, generation: Int) {
        val delay = (displayInstant(session.expiresAt).toEpochMilli() - System.currentTimeMillis())
            .coerceAtLeast(0L)
        mainHandler.postDelayed({
            if (generation == screenGeneration) managementSessionValid(session)
        }, delay)
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
    private fun formatFactTime(value: String): String = DateTimeFormatter.ofPattern("yyyy/MM/dd HH:mm")
        .withZone(ZoneId.systemDefault())
        .format(displayInstant(value))
    private fun displayInstant(value: String): Instant = Instant.parse(
        value.replace(Regex("(\\.\\d{9})\\d+(?=Z|[+-]\\d{2}:\\d{2}$)"), "$1"),
    )
    private fun localizedDeviceState(value: String): String = DeviceFactPresentation.state(value)

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
