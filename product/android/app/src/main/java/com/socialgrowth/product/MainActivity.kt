package com.socialgrowth.product

import android.app.AlertDialog
import android.app.Dialog
import android.graphics.Bitmap
import android.content.Intent
import android.content.res.ColorStateList
import androidx.core.content.ContextCompat
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.text.Editable
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.LayoutInflater
import android.view.ContextThemeWrapper
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
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
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import com.google.android.material.bottomnavigation.BottomNavigationView
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
    override fun setContentView(view: View?) {
        if (view == null) { super.setContentView(view); return }
        // Target SDK 36 draws behind system bars. Preserve comfortable touch
        // areas when the guide scrolls to its first and last actions.
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(view) { content, insets ->
            val bars = insets.getInsets(androidx.core.view.WindowInsetsCompat.Type.systemBars() or androidx.core.view.WindowInsetsCompat.Type.displayCutout())
            content.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
        super.setContentView(view)
        androidx.core.view.ViewCompat.requestApplyInsets(view)
    }

    private data class ControlAttempt(
        val fact: DeviceControlFact?,
        val requestAccepted: Boolean,
        val knownRejected: Boolean,
    )
    private data class DeviceLabelAttempt(val device: ProviderDevice?, val errorCode: String?)
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
    private lateinit var automaticConnectionMonitor: AutomaticConnectionMonitor
    private lateinit var deviceLabelCommandStore: ProviderDeviceLabelCommandStore
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
    private var exitedDevicesExpanded = false
    private var preparationResume: (() -> Unit)? = null
    private var preparationPause: (() -> Unit)? = null
    private var associationConfirmKey = newIdempotencyKey("association-confirm")
    private var connectionPermissionScreen: Int? = null
    private val connectionNotificationPermission = registerForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { granted ->
        val screen = connectionPermissionScreen
        connectionPermissionScreen = null
        if (screen != screenGeneration) return@registerForActivityResult
        if (granted) startConnectionChecking()
        else {
            startConnectionChecking()
            Toast.makeText(this, "自动连接仍会检查。首次配对需要通知，请在 App 设置中允许通知。", Toast.LENGTH_LONG).show()
        }
    }
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
        deviceLabelCommandStore = ProviderDeviceLabelCommandStore(this)
        automaticConnectionMonitor = AutomaticConnectionMonitor(this, executor)
        lifecycle.addObserver(automaticConnectionMonitor)
        invitationCode = (intent?.data?.toString() ?: intent?.getStringExtra("invitation"))
            ?.let { ProviderInvitation.parse(it, BuildConfig.API_BASE_URL) }
        if (installationStore.exists() && sessionStore.load() == null) {
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
        if (invitationCode != null) showAuthForm() else showUseChoice()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val incoming = intent.data?.toString()?.let { ProviderInvitation.parse(it, BuildConfig.API_BASE_URL) }
        if (incoming == null) return
        sessionStore.load()?.let { showManagement(it); return }
        invitationCode = incoming
        registrationMode = true
        challenge = null
        resetAttemptKeys()
        showAuthForm()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("pendingAssociationScan", pendingScanGeneration != null)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        PilotKeyClipboard.clearOwned(this)
        ++screenGeneration
        preparationPause?.invoke()
        preparationResume = null
        preparationPause = null
        pendingScanGeneration = null
        mainHandler.removeCallbacksAndMessages(null)
        executor.shutdownNow()
        super.onDestroy()
    }

    override fun onPause() {
        preparationPause?.invoke()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        preparationResume?.invoke()
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
            setOnClickListener { showUseChoice() }
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
        val invitationInput = if (registrationMode) editText("粘贴邀请码或邀请链接", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE).apply {
            id = R.id.provider_invitation
            contentDescription = "邀请码或邀请链接"
            isSaveEnabled = false
            minHeight = dp(64)
            maxLines = 3
            setText(invitationCode.orEmpty())
        } else null
        if (invitationInput != null) {
            card.addView(fieldLabel("邀请码或邀请链接"))
            card.addView(invitationInput, matchWrap().apply { topMargin = dp(8); bottomMargin = dp(18) })
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
            isSaveEnabled = false
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
        invitationInput?.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(text: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(text: CharSequence?, start: Int, before: Int, count: Int) {
                invitationCode = ProviderInvitation.parse(text?.toString().orEmpty(), BuildConfig.API_BASE_URL)
                challenge = null
                code.setText("")
                resetAttemptKeys()
                requestCode.text = "获取验证码"
                requestCode.isEnabled = invitationCode != null
                error.visibility = View.GONE
                setStatus(status, if (invitationCode != null) "邀请待校验" else "需要有效邀请",
                    if (invitationCode != null) "完成验证后才能注册。" else "请粘贴运营发给你的邀请码或邀请链接。", invitationCode == null)
            }
            override fun afterTextChanged(text: Editable?) = Unit
        })
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
                    result.temporaryCode?.let { code.setText(it) }
                    requestCode.text = if (result.temporaryCode != null) "验证码已填入" else "验证码已受理"
                    setStatus(status, if (requestedRegistration) "邀请已校验" else "账号已确认",
                        if (result.temporaryCode != null) "临时验证模式：验证码已自动填入，请继续。" else "请填写验证码继续。", false)
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

    private fun showUseChoice() {
        ++screenGeneration
        backAction = null
        managementSessionToken = null
        val root = vertical(16).apply {
            setBackgroundColor(canvas)
            setPadding(dp(20), dp(24), dp(20), dp(24))
        }
        root.addView(label("SocialGrowth", 20f, ink, Typeface.BOLD), matchWrap())
        root.addView(label("一台手机，管理与执行", 30f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(28) })
        root.addView(label("登录后可直接接入这台手机，不需要另一台手机扫码。", 15f, secondary), matchWrap().apply { topMargin = dp(8) })
        val management = vertical(14).apply {
            id = R.id.home_management
            background = rounded(Color.WHITE, 12)
            isClickable = true
            isFocusable = true
            contentDescription = "管理我的设备：查看本人设备、处理协助事项和查看分佣"
            setOnClickListener { openManagement() }
        }
        management.setPadding(dp(18), dp(16), dp(18), dp(16))
        management.addView(label("管理我的设备", 20f, ink, Typeface.BOLD))
        management.addView(label("查看本人设备、处理协助事项和查看分佣", 14f, secondary))
        management.minimumHeight = dp(112)
        root.addView(management, matchWrap().apply { topMargin = dp(28) })
        val execution = vertical(14).apply {
            id = R.id.home_execution
            background = rounded(Color.WHITE, 12)
            isClickable = true
            isFocusable = true
            contentDescription = "查看本机接入：准备网络连接与执行设置"
            setOnClickListener { showExecutionIntro() }
        }
        execution.setPadding(dp(18), dp(16), dp(18), dp(16))
        execution.addView(label("查看本机接入", 20f, ink, Typeface.BOLD))
        execution.addView(label("准备网络连接与执行设置，也可随时返回管理", 14f, secondary))
        execution.minimumHeight = dp(112)
        root.addView(execution, matchWrap().apply { topMargin = dp(16) })
        root.addView(secondaryButton("受邀加入").apply {
            id = R.id.home_invitation
            setOnClickListener {
                registrationMode = true
                challenge = null
                resetAttemptKeys()
                sessionStore.load()?.let(::showManagement) ?: showAuthForm()
            }
        }, matchHeight(52).apply { topMargin = dp(24) })
        root.addView(label("你决定是否关联本机。切换页面不会自动开始或停止任务。", 14f, secondary), matchWrap().apply { topMargin = dp(8) })
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        })
    }

    private fun openManagement() {
        sessionStore.load()?.let { showManagement(it) } ?: run {
            registrationMode = invitationCode != null
            showAuthForm()
        }
    }

    private fun showExecutionIntro() {
        ++screenGeneration
        backAction = { showUseChoice() }
        val root = vertical(20).apply { setBackgroundColor(canvas) }
        root.addView(backHeader("执行手机接入") { showUseChoice() }, matchWrap())
        root.addView(label("准备这台手机执行任务", 28f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(22) })
        root.addView(label("你可以在本机管理设备，也可以让本机执行任务。接下来会引导你确认关联、连接网络和允许远程连接；完成准备后，平台还需核验执行条件。执行期间请避免操作任务使用的应用。", 15f, secondary), matchWrap().apply { topMargin = dp(10) })
        root.addView(label("无需自行准备 Tailscale 账号或购买 VPN 订阅。接入信息由平台提供，手机与平台不需要连接同一个 Wi-Fi。", 15f, secondary), matchWrap().apply { topMargin = dp(10) })
        root.addView(primaryButton("继续在本机接入").apply {
            setOnClickListener {
                try {
                    installationStore.ensureCredential()
                    showInstallationLoading()
                } catch (_: Exception) {
                    Toast.makeText(this@MainActivity, "无法安全建立本机身份，请重试。", Toast.LENGTH_LONG).show()
                }
            }
        }, matchHeight(54).apply { topMargin = dp(24) })
        root.addView(secondaryButton("先准备网络与无线调试").apply {
            setOnClickListener { showInstallationNetworkGuide(null) { showExecutionIntro() } }
        }, matchHeight(50).apply { topMargin = dp(10) })
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        })
    }

    private fun showManagement(session: StoredProviderSession) {
        val generation = ++screenGeneration
        backAction = null
        managementSessionToken = session.sessionToken
        pendingScanGeneration = null
        val content = vertical(20).apply { setBackgroundColor(canvas) }
        content.addView(appHeader("设备管理"), matchWrap())
        content.addView(label("我的设备", 30f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(22) })
        val identity = label("正在验证管理身份…", 14f, secondary)
        content.addView(identity, matchWrap().apply { topMargin = dp(7) })
        val summary = label("正在读取本人设备…", 14f, secondary)
        content.addView(summary, matchWrap().apply { topMargin = dp(12) })
        val local = vertical(18).apply { background = rounded(Color.WHITE, 12) }
        local.addView(label("这台手机 · ${shortDeviceName()}", 20f, ink, Typeface.BOLD))
        val localStatus = label("正在核对本机接入状态…", 14f, secondary)
        local.addView(localStatus, matchWrap().apply { topMargin = dp(8) })
        val localConnection = ConnectionStatusView(this, false, "associated_pending_access", localInstallation = true).apply { visibility = View.GONE }
        local.addView(localConnection, matchWrap().apply { topMargin = dp(12) })
        val localAction = primaryButton("接入这台手机").apply {
            isEnabled = false
            setOnClickListener { showInstallationLoading(localProvider = session) }
        }
        local.addView(localAction, matchHeight(54).apply { topMargin = dp(14) })
        local.addView(label("无需第二台手机。确认关联后，按步骤准备网络与远程连接。", 13f, secondary), matchWrap().apply { topMargin = dp(8) })
        content.addView(local, matchWrap().apply { topMargin = dp(18) })
        val add = secondaryButton("添加其他手机 · 扫码").apply {
            id = R.id.provider_add_device
            contentDescription = "扫码添加执行手机"
            isEnabled = false
            setOnClickListener { startAssociationScan() }
        }
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
        content.addView(add, matchHeight(50).apply { topMargin = dp(12) })
        content.addView(secondaryButton("其他手机无法扫码？输入关联码").apply {
            id = R.id.provider_enter_association_code
            setOnClickListener { showAssociationCodeInput(session) }
        }, matchHeight(52).apply { topMargin = dp(8) })
        content.addView(label("扫码或手动输入都只用于核对设备；确认前不会建立归属。", 13f, secondary).apply {
            gravity = Gravity.CENTER
        }, matchWrap().apply { topMargin = dp(9) })
        content.addView(label(DeviceFactPresentation.ACCESS_BOUNDARY, 13f, secondary), matchWrap().apply { topMargin = dp(14) })
        content.addView(label("需要我处理", 18f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(24) })
        val assistance = vertical(14).apply {
            id = R.id.provider_assistance_list
            background = rounded(Color.WHITE, 12)
            addView(label("正在读取协助事项…", 14f, secondary), matchWrap())
        }
        content.addView(assistance, matchWrap().apply { topMargin = dp(10) })
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(content, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        val page = vertical(0).apply {
            setBackgroundColor(canvas)
            addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(providerNavigation(session, "devices"), matchWrap())
        }
        setContentView(page)
        guardManagementExpiry(session, generation)
        readProviderAssistance(session, generation, assistance)
        readProviderDevices(session, generation,
            success = { list ->
                identity.text = "${session.displayName} · ${session.phoneHint}"
                add.isEnabled = true
                localAction.isEnabled = true
                localStatus.text = "本机尚待核对。点击下方按钮继续；确认前不会建立关联。"
                summary.text = "已关联 ${list.size} 台设备"
                renderDevices(devices, list, session)
                val token = installationStore.load()?.activeSessionToken()
                if (token != null) runManagementNetwork(session, generation,
                    action = { associationApi.installationState(token) },
                    success = { state ->
                        when {
                            state.state == "unassociated" -> localStatus.text = "尚未关联。下一步：核对本机并确认归属。"
                            list.any { it.deviceId == state.deviceId } -> {
                                localStatus.text = "已关联到你的账号 · ${DeviceFactPresentation.state(state.state).removePrefix("已关联 · ")}"
                                localAction.text = "继续本机准备"
                                localConnection.deviceState = state.state
                                localConnection.visibility = View.VISIBLE
                                observeConnection(localConnection, generation, session) {
                                    DeviceConnectionApiClient(api).providerState(session.sessionToken, requireNotNull(state.deviceId))
                                }
                            }
                            else -> {
                                localStatus.text = "本机已关联到其他账号，请使用原账号管理。"
                                localAction.isEnabled = false
                            }
                        }
                    },
                    failure = { localStatus.text = "本机状态暂时无法确认。点击继续可重新检查。" },
                )
            },
            failure = { message ->
                identity.text = "身份尚未确认"
                summary.text = "设备读取失败"
                localStatus.text = "暂时联系不上平台，请刷新后继续。"
                renderDeviceError(devices, message, session)
            },
        )
    }

    private fun readProviderAssistance(session: StoredProviderSession, generation: Int, container: LinearLayout) {
        readProviderAssistancePage(session, generation, container, after = null, append = false)
    }

    private fun readProviderAssistancePage(
        session: StoredProviderSession,
        generation: Int,
        container: LinearLayout,
        after: UUID?,
        append: Boolean,
    ) {
        runManagementNetwork(session, generation,
            action = { ProviderAssistanceApiClient(BuildConfig.API_BASE_URL).list(session.sessionToken, after) },
            success = { page ->
                val existing = if (append) container.tag as? List<*> else null
                val combined = (existing.orEmpty().filterIsInstance<ProviderAssistanceTodo>() + page.todos)
                container.tag = combined
                renderProviderAssistance(container, combined, page.nextAfterTodoId, session, generation)
            },
            failure = {
                if (!append) {
                    container.removeAllViews()
                    container.addView(label("本人协助进展暂时无法读取。", 14f, secondary), matchWrap())
                } else container.addView(label("更多事项暂时无法读取。", 13f, secondary), matchWrap().apply { topMargin = dp(8) })
                container.addView(secondaryButton("重试读取").apply {
                    setOnClickListener { readProviderAssistancePage(session, generation, container, after, append) }
                }, matchHeight(44).apply { topMargin = dp(8) })
            },
        )
    }

    private fun renderProviderAssistance(
        container: LinearLayout,
        todos: List<ProviderAssistanceTodo>,
        nextAfterTodoId: UUID?,
        session: StoredProviderSession,
        generation: Int,
    ) {
        container.removeAllViews()
        if (todos.isEmpty()) {
            container.addView(label("目前没有本人设备协助事项。", 14f, secondary), matchWrap())
            return
        }
        todos.forEach { todo ->
            val card = vertical(12).apply { background = rounded(canvas, 8) }
            card.addView(label(
                if (todo.status == "open") "需要本人留意" else "处理后等待复核",
                16f, ink, Typeface.BOLD,
            ))
            card.addView(label("网络接入协助 · ${todo.impactCount} 台设备 · ${todo.noteCount} 条进展记录", 13f, secondary), matchWrap().apply { topMargin = dp(5) })
            if (todo.impacts.isEmpty()) {
                card.addView(label("当前没有可显示的本人关联设备；请刷新设备清单核对。", 13f, secondary), matchWrap().apply { topMargin = dp(8) })
            } else todo.impacts.forEach { impact ->
                card.addView(detailRow(
                    impact.deviceLabel,
                    "设备标识尾号 ${impact.deviceId.toString().takeLast(8)} · 发生时版本 ${impact.recordedDeviceVersion}，非当前状态",
                ), matchWrap().apply { topMargin = dp(8) })
            }
            card.addView(label("事项更新时间 ${formatFactTime(todo.updatedAt.toString())}", 12f, secondary), matchWrap().apply { topMargin = dp(8) })
            container.addView(card, matchWrap().apply { topMargin = dp(8) })
        }
        if (nextAfterTodoId != null) {
            container.addView(secondaryButton("查看更多本人协助").apply {
                setOnClickListener { readProviderAssistancePage(session, generation, container, nextAfterTodoId, append = true) }
            }, matchHeight(46).apply { topMargin = dp(8) })
        }
        container.addView(label("事项状态为汇总进展，不代表单台手机当前在线、健康或已恢复。", 12f, secondary), matchWrap().apply { topMargin = dp(10) })
    }

    private fun showInstallationLoading(refreshSession: Boolean = false, localProvider: StoredProviderSession? = null) {
        val generation = ++screenGeneration
        backAction = localProvider?.let { { showManagement(it) } }
        managementSessionToken = localProvider?.sessionToken
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
                    if (localProvider != null) {
                        val inspection = associationApi.inspect(localProvider.sessionToken, association.associationCode)
                        require(inspection.installationId == state.installationId)
                        mainHandler.post {
                            if (generation == screenGeneration) showAssociationConfirmation(localProvider, inspection, local = true)
                        }
                    } else mainHandler.post {
                        if (generation == screenGeneration) showInstallationCode(stored, association)
                    }
                } else {
                    if (localProvider != null) {
                        require(associationApi.devices(localProvider.sessionToken).any { it.deviceId == state.deviceId })
                    }
                    installationStore.clearAssociation(stored)
                    mainHandler.post {
                        if (generation == screenGeneration) {
                            if (localProvider != null) showInstallationNetworkGuide(state) { showManagement(localProvider) }
                            else showInstallationAssociated(state)
                        }
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
        root.addView(label("只有这一台手机？在本机登录后即可确认关联。", 16f, secondary), matchWrap().apply { topMargin = dp(7) })
        root.addView(primaryButton("在本机管理并关联").apply { setOnClickListener { openManagement() } }, matchHeight(54).apply { topMargin = dp(14) })
        root.addView(label("也可用另一台已登录的手机扫描下方二维码。", 13f, secondary), matchWrap().apply { topMargin = dp(12) })
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
        root.addView(secondaryButton("返回设备管理").apply { setOnClickListener { openManagement() } }, matchHeight(50))
        root.addView(label("本机执行状态", 28f, ink, Typeface.BOLD), wrapWrap().apply { topMargin = dp(22) })
        root.addView(label("本机 ${shortDeviceName()}", 16f, secondary), wrapWrap().apply { topMargin = dp(8) })
        root.addView(label("仅显示这台执行手机的当前事实。", 14f, secondary).apply {
            gravity = Gravity.CENTER
        }, matchWrap().apply { topMargin = dp(12) })
        val usage = vertical(12).apply { background = rounded(Color.WHITE, 12) }
        usage.addView(label("无法确认", 21f, ink, Typeface.BOLD))
        usage.addView(label("当前没有可信的本机业务占用事实；不能据此判断空闲。", 14f, secondary), matchWrap().apply { topMargin = dp(4) })
        root.addView(usage, matchWrap().apply { topMargin = dp(18) })
        val facts = vertical(16).apply { background = rounded(Color.WHITE, 12) }
        facts.addView(detailRow("关联状态", DeviceFactPresentation.state(state.state)))
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        val connectionFact = ConnectionStatusView(this, true, state.state, localInstallation = true)
        facts.addView(connectionFact, matchWrap())
        facts.addView(detailRow("事实更新时间", formatFactTime(state.updatedAt)))
        val factScreen = screenGeneration
        observeConnection(connectionFact, factScreen) {
            val identity = installationStore.load() ?: error("Missing installation")
            val token = identity.activeSessionToken() ?: error("Inactive installation")
            DeviceConnectionApiClient(api).installationState(token, requireNotNull(state.deviceId)).also {
                require(it.factVersion == state.factVersion)
            }
        }
        root.addView(facts, matchWrap().apply { topMargin = dp(24) })
        val controlStatus = label("正在读取本机暂停进展…", 14f, secondary)
        root.addView(controlStatus, matchWrap().apply { topMargin = dp(16) })
        val pause = primaryButton("暂停本机").apply {
            isEnabled = state.deviceId != null && state.state in setOf("associated_pending_access", "access_ready")
            if (state.state == "paused") text = "查看暂停进展"
            setOnClickListener {
                showControlConfirmation(
                    "暂停本机",
                    "本机 ${shortDeviceName()}",
                    "停止接新任务，当前操作会尽快停止；恢复可返回设备管理申请。",
                ) {
                    submitInstallationPause(requireNotNull(state.deviceId), controlStatus, this)
                }
            }
        }
        root.addView(pause, matchHeight(54).apply { topMargin = dp(12) })
        root.addView(secondaryButton("网络连接与准备设置").apply {
            setOnClickListener { showInstallationNetworkGuide(state) }
        }, matchHeight(50).apply { topMargin = dp(8) })
        val controlScreen = screenGeneration
        val initialIdentity = installationStore.load()
        val initialToken = initialIdentity?.activeSessionToken()
        if (initialToken == null) {
            controlStatus.text = "无法读取控制进展；本机身份会话已失效。"
            pause.isEnabled = false
        } else runNetwork(
            action = { DeviceControlApiClient(BuildConfig.API_BASE_URL).installation(initialToken, requireNotNull(state.deviceId)) },
            success = { fact ->
                if (controlScreen == screenGeneration) {
                    controlStatus.text = controlStatusText(fact)
                    if (fact.intent in setOf("pause_requested", "paused")) {
                        pause.text = if (fact.stop == "confirmed") "本机已确认停止" else "暂停请求处理中"
                        pause.isEnabled = false
                    }
                }
            },
            failure = { if (controlScreen == screenGeneration) controlStatus.text = "暂停进展暂时无法确认；可刷新重试。" },
        )
        root.addView(label(DeviceFactPresentation.ACCESS_BOUNDARY, 14f, secondary).apply {
            gravity = Gravity.CENTER
        }, matchWrap().apply { topMargin = dp(18) })
        root.addView(secondaryButton("刷新状态").apply { setOnClickListener { showInstallationLoading() } }, matchHeight(54).apply { topMargin = dp(28) })
        root.addView(label("暂停请求受理、接新任务停止和本机操作停止是不同事实；页面只按服务端回执更新。", 13f, secondary), matchWrap().apply { topMargin = dp(16) })
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        })
    }

    private fun showInstallationNetworkGuide(state: InstallationSelfView?, returnTo: (() -> Unit)? = null) {
        preparationPause?.invoke()
        val screen = ++screenGeneration
        val goBack = returnTo ?: { showInstallationLoading() }
        backAction = goBack
        val root = vertical(20).apply { setBackgroundColor(canvas) }
        root.addView(backHeader("本机准备") { goBack() }, matchWrap())
        root.addView(label("让这台手机连接到平台", 27f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(18) })
        val guideIntroduction = label("按下面的步骤完成首次设置。每次从设置返回，我们会自动检查进度。", 15f, secondary)
        root.addView(guideIntroduction, matchWrap().apply { topMargin = dp(8) })
        val progress = label("正在检查本机…", 15f, blue, Typeface.BOLD)
        val connectionSummary = ConnectionStatusView(this, true, state?.state ?: "unassociated", localInstallation = true).apply {
            setPadding(dp(16), dp(16), dp(16), dp(8))
            background = rounded(Color.WHITE, 12)
        }
        root.addView(connectionSummary, matchWrap().apply { topMargin = dp(16) })
        root.addView(progress, matchWrap().apply { topMargin = dp(10) })
        fun section(title: String, explanation: String): LinearLayout {
            val box = vertical(16).apply { background = rounded(Color.WHITE, 12) }
            box.addView(label(title, 19f, ink, Typeface.BOLD))
            box.addView(label(explanation, 15f, secondary), matchWrap().apply { topMargin = dp(8) })
            root.addView(box, matchWrap().apply { topMargin = dp(14) })
            return box
        }
        val network = section("1 · 连接管理网络", "先连接能够上网的稳定 Wi-Fi，再返回完成本机关联。手机与平台不需要在同一个 Wi-Fi。首次接入按下面的说明连接；已使用 SFA 的手机请保留现有配置。")
        val networkStatus = label("正在检查网络…", 14f, secondary)
        network.addView(networkStatus, matchWrap().apply { topMargin = dp(10) })
        val wifi = secondaryButton("连接 Wi-Fi").apply {
            setOnClickListener { openPreparationSetting(android.provider.Settings.ACTION_WIFI_SETTINGS, "请在系统设置中打开 Wi-Fi，并连接可用网络。") }
        }
        network.addView(wifi, matchHeight(50).apply { topMargin = dp(10) })
        val openTailscale = primaryButton("打开 Tailscale").apply { setOnClickListener { openTailscaleSetup() } }
        network.addView(openTailscale, matchHeight(52).apply { topMargin = dp(8) })
        network.addView(label("无需自行注册 Tailscale 账号。完成关联后，点击“获取并复制接入密钥”，再打开 Tailscale；点击右上角齿轮进入 Settings（设置），选择 Accounts（账号），再点右上角三点菜单 → Use an auth key（使用接入密钥）。长按输入框粘贴，点击 Add account（添加账号）。如果首页显示 Connect（连接），再点击它，并按系统提示允许 VPN 连接。返回这里后，App 会自动检查结果；只有显示平台已确认本机网络节点，才能继续。", 14f, secondary), matchWrap().apply { topMargin = dp(10) })
        network.addView(label("以上 Tailscale 步骤仅用于首次管理接入。已使用 SFA 时，不要重新连接官方 Tailscale 或再次领取密钥。业务上网由手机订阅提供；请按第 4 步完成。", 14f, secondary), matchWrap().apply { topMargin = dp(10) })

        val copyKey = secondaryButton("获取并复制接入密钥")
        copyKey.isEnabled = state?.deviceId != null
        copyKey.alpha = if (copyKey.isEnabled) 1f else 0.45f
        network.addView(copyKey, matchHeight(50).apply { topMargin = dp(8) })
        val keyStatus = label("", 14f, secondary).apply { visibility = View.GONE }
        network.addView(keyStatus, matchWrap().apply { topMargin = dp(8) })
        if (state?.deviceId == null) {
            keyStatus.visibility = View.VISIBLE
            keyStatus.text = "尚未确认本机关联，接入密钥和连接检查暂不可用。请返回完成关联；如果始终无法联系平台，请联系邀请你的运营人员核对接入服务地址。"
            network.addView(secondaryButton("返回完成本机关联").apply {
                setOnClickListener { goBack() }
            }, matchHeight(50).apply { topMargin = dp(8) })
        }
        copyKey.setOnClickListener {
            copyKey.isEnabled = false
            runNetwork(action = {
                val token = installationStore.load()?.activeSessionToken() ?: error("Inactive installation")
                val result = JSONObject(api.post("/api/installation/network-setup/key",
                    JSONObject().put("contractVersion", "android-network-setup-v1"), token))
                require(result.getString("contractVersion") == "android-network-setup-v1")
                require(result.getString("usage") == "pilot_shared")
                if (!result.isNull("expiresAt")) require(Instant.parse(result.getString("expiresAt")).isAfter(Instant.now()))
                result.getString("key").also { require(it.startsWith("tskey-auth-") && it.length <= 512) }
            }, success = { key ->
                copyKey.isEnabled = true
                if (screen != screenGeneration) return@runNetwork
                PilotKeyClipboard.copy(this, key)
                keyStatus.visibility = View.VISIBLE
                keyStatus.text = "密钥已复制，请及时粘贴。App 会尝试在 1 分钟后清除。请打开 Tailscale，按“齿轮设置 → Accounts → 三点菜单 → Use an auth key”进入输入页，粘贴后点击 Add account；首页若显示 Connect，再点击连接，然后返回这里检查。"
            }, failure = {
                copyKey.isEnabled = true
                if (screen == screenGeneration) {
                    keyStatus.visibility = View.VISIBLE
                    keyStatus.text = "暂时无法获取本机接入密钥。请重新检查平台连接；仍失败时，联系邀请你的运营人员核对本机接入配置。已有 VPN 连接不代表本机已准入。"
                }
            })
        }

        val debugging = section("2 · 允许远程连接", "平台需要通过系统的“无线调试”连接本机。此项必须由你在这台执行手机上开启。")
        debugging.addView(label("首次接入需要你按提示完成设置和配对。平台连接成功前，Artemis 无法替你操作这台手机；无需第二台手机或连接电脑。", 14f, secondary), matchWrap().apply { topMargin = dp(8) })
        val debuggingStatus = label("正在检查设置…", 14f, secondary)
        debugging.addView(debuggingStatus, matchWrap().apply { topMargin = dp(10) })
        val developerHelp = label("先打开“关于手机”，连续点击“版本号”7 次，按系统提示验证锁屏密码。Samsung 的版本号在“软件信息”中。", 14f, secondary)
        debugging.addView(developerHelp, matchWrap().apply { topMargin = dp(8) })
        val about = secondaryButton("打开关于手机").apply {
            setOnClickListener { openPreparationSetting(android.provider.Settings.ACTION_DEVICE_INFO_SETTINGS, "请打开设置 → 关于手机 → 软件信息 → 版本号。") }
        }
        debugging.addView(about, matchHeight(50).apply { topMargin = dp(10) })
        debugging.addView(primaryButton("打开开发者选项").apply {
            setOnClickListener { openPreparationSetting(android.provider.Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS, "请打开系统设置中的开发者选项，再找到“无线调试”。") }
        }, matchHeight(52).apply { topMargin = dp(8) })
        debugging.addView(label("找到“无线调试”并开启，按系统提示允许当前 Wi-Fi。返回这里后会自动检查。", 14f, secondary), matchWrap().apply { topMargin = dp(10) })

        val pairing = section("3 · 完成连接确认", "完成前两步后，App 会自动检查并连接平台。首次配对时，在系统“无线调试”页面选择“使用配对码配对设备”，记住 6 位数字，保持弹窗打开，下拉通知栏，展开 SocialGrowth 通知并点击“输入配对码”。在通知内输入并发送，看到连接结果后再返回 App。不要切换应用或关闭配对弹窗。")
        val pairingStatus = label("完成前两步后，等待平台确认连接。", 15f, secondary)
        pairing.addView(pairingStatus, matchWrap().apply { topMargin = dp(10) })
        pairing.addView(label("已有有效配对时会尝试恢复连接，无需重复输入配对码。手机重启或切换 Wi-Fi 后，如需重新开启设置，会在这里提示。", 14f, secondary), matchWrap().apply { topMargin = dp(8) })
        val keepConnected = secondaryButton("暂停自动连接")
        keepConnected.isEnabled = state?.deviceId != null
        pairing.addView(keepConnected, matchHeight(52).apply { topMargin = dp(10) })
        keepConnected.setOnClickListener {
            if (Build.VERSION.SDK_INT < 34) {
                Toast.makeText(this, "当前自动连接检查需要 Android 14 或更高版本。", Toast.LENGTH_LONG).show()
            } else {
                if (EndpointReportingService.automaticEnabled(this)) {
                    EndpointReportingService.setAutomaticEnabled(this, false)
                    startService(Intent(this, EndpointReportingService::class.java).setAction(EndpointReportingService.STOP))
                } else {
                    EndpointReportingService.setAutomaticEnabled(this, true)
                    if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                        connectionPermissionScreen = screenGeneration
                        connectionNotificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
                    } else startConnectionChecking()
                }
                updateConnectionControl(keepConnected, state)
            }
        }
        pairing.addView(secondaryButton("在本机完成配对").apply {
            isEnabled = state?.deviceId != null
            setOnClickListener {
                val session = sessionStore.load()
                if (session == null) {
                    openManagement()
                    return@setOnClickListener
                }
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("一台手机完成配对")
                    .setMessage("1. App 会自动开始连接检查；如果你曾主动暂停，请先恢复自动连接。首次配对请在 App 设置中允许通知。\n2. 打开系统“无线调试”，选择“使用配对码配对设备”。\n3. 保持弹窗打开，记住 6 位数字，下拉并展开 SocialGrowth 通知。\n4. 点击通知中的“输入配对码”，输入并发送；等待提示后返回 App 查看连接结果。\n\n不要切换应用或关闭系统弹窗。管理登录失效时请先返回 App 登录，再重新打开系统配对弹窗。")
                    .setPositiveButton("知道了", null).show()
            }
        }, matchHeight(50).apply { topMargin = dp(8) })
        pairing.addView(label("打开 App 后自动检查；已有配对会自动重连，短暂网络异常会重试。你可以主动暂停自动连接，暂停后须自行恢复。首次系统授权和配对仍需按提示完成。", 14f, secondary), matchWrap().apply { topMargin = dp(8) })
        pairing.addView(secondaryButton("允许连接通知").apply {
            setOnClickListener {
                connectionPermissionScreen = screenGeneration
                connectionNotificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            }
            visibility = if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this@MainActivity, android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) View.VISIBLE else View.GONE
        }, matchHeight(50).apply { topMargin = dp(8) })
        val businessNetwork = section("4 · 准备业务上网", "平台连接确认后，Artemis 才能协助安装可信客户端、导入平台提供的私有文件和检查上网结果。安装确认、系统 VPN 授权和连接切换仍需你按提示处理。")
        businessNetwork.addView(label("使用手机订阅：FlClash 关闭 VPN，运行本地代理，保留平台确认的可用节点和 Global 模式。SFA 是唯一开启 VPN 的客户端，负责管理连接和业务分流。不要同时开启官方 Tailscale 或 FlClash VPN，不要选择 Macmini 或其他出口节点。", 14f, secondary), matchWrap().apply { topMargin = dp(10) })
        businessNetwork.addView(label("首次切换请等待运营确认配置已准备好。只导入平台为本机提供的文件，不要复制另一台手机的配置。打开 SFA，按提示导入文件并允许 VPN 连接，再返回这里检查。切换可能暂时断开远程操作；只有重新显示“平台已连接到这台手机”，且平台确认 Facebook 和 YouTube 能正常读取，才算完成。", 14f, secondary), matchWrap().apply { topMargin = dp(10) })
        businessNetwork.addView(secondaryButton("打开 SFA").apply { setOnClickListener { openNetworkClient("io.nekohasekai.sfa", "SFA") } }, matchHeight(50).apply { topMargin = dp(10) })
        businessNetwork.addView(secondaryButton("打开 FlClash").apply { setOnClickListener { openNetworkClient("com.follow.clash", "FlClash") } }, matchHeight(50).apply { topMargin = dp(8) })
        businessNetwork.addView(label("连接失败时，先检查 SFA 是否已启动、FlClash 核心是否运行且 VPN 关闭。不要删除配置、重新配对或更换账号。仍无法连接时联系运营，按指导恢复此前可用的连接；不要重复执行业务任务。订阅、密码和接入密钥不要发送到普通聊天或截图中。", 14f, secondary), matchWrap().apply { topMargin = dp(10) })
        val serverStatus = label("正在检查平台连接…", 14f, secondary)
        if (state?.deviceId == null) serverStatus.text = "当前尚未确认本机关联。请点击“返回完成本机关联”，确认后再继续平台连接。"
        root.addView(serverStatus, matchWrap().apply { topMargin = dp(18) })
        val retry = secondaryButton("重新检查")
        root.addView(retry, matchHeight(50).apply { topMargin = dp(10) })
        root.addView(secondaryButton("检查通知与后台运行设置").apply {
            setOnClickListener { openOwnAppSettings() }
        }, matchHeight(50).apply { topMargin = dp(8) })
        root.addView(label("完成连接后，还需平台核对设备和账号。不会因为返回页面或重新联网就恢复已暂停的设备。", 13f, secondary), matchWrap().apply { topMargin = dp(12) })

        // Discovery runs only while this guide is visible. Reports and remote
        // authority are separate; a local candidate never completes step 3.
        var discovery: NativeEndpointDiscovery? = null
        var visible = false
        var busy = false
        var checkSequence = 0
        var remoteConnected = false
        var networkVerified = false
        var lastServerCheck = 0L
        var lastServerSuccess = 0L
        fun current() = screen == screenGeneration && !isDestroyed && !isFinishing
        fun updateLocal() {
            if (!current()) return
            val checks = DevicePreparationChecks.read(this)
            guideIntroduction.text = if (remoteConnected) "连接正常，无需重复配对。下方设置可用于检查与恢复连接；返回设备管理不会启动或停止任务。" else "按下面的步骤完成首次设置。每次从设置返回，我们会自动检查进度。"
            updateConnectionControl(keepConnected, state)
            wifi.visibility = if (checks.wifiConnected) View.GONE else View.VISIBLE
            openTailscale.text = when { checks.sfaInstalled -> "打开 SFA"; checks.tailscaleInstalled -> "打开 Tailscale"; else -> "安装 Tailscale" }
            copyKey.visibility = if (checks.sfaInstalled) View.GONE else View.VISIBLE
            networkStatus.text = when {
                networkVerified -> "平台已确认本机网络节点；平台上网和执行资格仍需后续核验。"
                !checks.wifiConnected -> "请先连接 Wi-Fi。"
                state?.deviceId == null -> "请先返回完成本机关联，再按平台提供的接入信息连接。"
                checks.sfaInstalled && !checks.vpnPresent -> "请打开 SFA 并启动平台为本机提供的配置；App 不会改为连接官方 Tailscale。"
                checks.sfaInstalled && !checks.clashInstalled -> "已安装 SFA；业务代理尚缺 FlClash，请联系运营提供可信安装包。"
                !checks.networkClientInstalled -> "Wi-Fi 已连接，请安装配套 Tailscale。"
                !checks.vpnPresent -> "App 会尝试恢复已有 Tailscale 连接；首次登录或系统授权请打开 Tailscale 完成。"
                else -> "已检测到 VPN；正在等待平台确认本机入网。"
            }
            developerHelp.visibility = if (checks.developerOptions == true) View.GONE else View.VISIBLE
            about.visibility = developerHelp.visibility
            debuggingStatus.text = when {
                !checks.discoverySupported -> "当前版本的自动检查需要 Android 14 或更高版本，请联系运营确认支持机型。"
                checks.developerOptions == false -> "请先开启开发者选项。"
                checks.wirelessDebugging == false -> "无线调试尚未开启。"
                checks.wirelessDebugging == true -> "无线调试已开启，接下来确认平台连接。"
                else -> "暂时无法读取开关，请按系统页面完成设置后返回。"
            }
            val found = Build.VERSION.SDK_INT >= 34 && discovery?.snapshot()?.connect?.status == EndpointObservationStatus.CANDIDATE
            pairingStatus.text = when {
                remoteConnected -> "平台已连接到这台手机，无需再次配对。"
                !networkVerified -> "请先完成本机关联和平台网络确认。"
                !checks.discoverySupported -> "当前手机暂不能自动完成连接检查。"
                checks.wirelessDebugging == false -> "请先完成上一步。"
                found -> "本机已准备好，等待平台确认。首次使用请点击“在本机完成配对”。"
                else -> "正在检查本机是否可连接；首次使用请点击“在本机完成配对”。"
            }
            progress.text = when {
                remoteConnected -> "本机已连接到平台"
                !networkVerified || !checks.wifiConnected || !checks.networkClientInstalled || !checks.vpnPresent -> "当前步骤：连接管理网络"
                checks.wirelessDebugging != true -> "当前步骤：允许远程连接"
                else -> "当前步骤：等待连接确认"
            }
        }
        fun checkServer() {
            if (!current() || !visible || busy || state?.deviceId == null) return
            busy = true
            connectionSummary.setRefreshing(true)
            val sequence = ++checkSequence
            lastServerCheck = android.os.SystemClock.elapsedRealtime()
            runNetwork(action = {
                val identity = installationStore.load() ?: error("Missing installation")
                val token = identity.activeSessionToken() ?: error("Inactive installation")
                DeviceConnectionApiClient(api).installationState(token, requireNotNull(state.deviceId))
            }, success = { fact ->
                busy = false
                if (current() && visible && sequence == checkSequence) {
                    lastServerSuccess = android.os.SystemClock.elapsedRealtime()
                    remoteConnected = fact.connected
                    networkVerified = fact.networkState in setOf("admitted", "pilot_verified")
                    serverStatus.text = DeviceConnectionBoundary.message(fact)
                    connectionSummary.accept(fact)
                    updateLocal()
                }
            }, failure = {
                busy = false
                if (current() && visible && sequence == checkSequence) {
                    remoteConnected = false
                    networkVerified = false
                    serverStatus.text = "暂时联系不上平台。请检查网络后重试；已完成的系统设置无需重做。"
                    connectionSummary.render(null, failed = true)
                    updateLocal()
                }
            })
        }
        val tick = object : Runnable {
            override fun run() {
                if (!current() || !visible) return
                if ((remoteConnected || networkVerified) && android.os.SystemClock.elapsedRealtime() - lastServerSuccess >= 10_000) {
                    remoteConnected = false
                    networkVerified = false
                    serverStatus.text = "正在重新确认平台连接…"
                    connectionSummary.render(null, refreshing = busy)
                }
                if (Build.VERSION.SDK_INT >= 34 && discovery?.snapshot()?.active != true) {
                    discovery?.close()
                    discovery = NativeEndpointDiscovery(this@MainActivity).also { it.start() }
                }
                updateLocal()
                if (android.os.SystemClock.elapsedRealtime() - lastServerCheck >= 5_000) checkServer()
                mainHandler.postDelayed(this, 2_000)
            }
        }
        val resume = {
            if (current()) {
                visible = true
                remoteConnected = false
                networkVerified = false
                connectionSummary.render(null, refreshing = true)
                if (state?.deviceId != null) serverStatus.text = "正在确认平台连接…"
                mainHandler.removeCallbacks(tick)
                tick.run()
                checkServer()
            }
        }
        preparationPause = {
            visible = false
            ++checkSequence
            mainHandler.removeCallbacks(tick)
            if (Build.VERSION.SDK_INT >= 34) discovery?.close()
            discovery = null
            connectionSummary.render(null)
        }
        preparationResume = resume
        retry.setOnClickListener { updateLocal(); checkServer() }
        connectionSummary.refreshAction = { updateLocal(); checkServer() }
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        })
        resume()
    }

    private fun startConnectionChecking() {
        // Resuming connection automation is distinct from resuming business participation.
        automaticConnectionMonitor.recheck()
    }
    private fun updateConnectionControl(button: Button, state: InstallationSelfView?) {
        button.text = if (EndpointReportingService.automaticEnabled(this)) "暂停自动连接" else "恢复自动连接"
        button.isEnabled = Build.VERSION.SDK_INT >= 34 && state?.deviceId != null && state.state in setOf("associated_pending_access", "access_ready")
        button.alpha = if (button.isEnabled) 1f else 0.45f
    }

    private fun openTailscaleSetup() {
        if (DevicePreparationChecks.read(this).sfaInstalled) {
            openNetworkClient("io.nekohasekai.sfa", "SFA")
            return
        }
        val launch = packageManager.getLaunchIntentForPackage("com.tailscale.ipn")
        if (launch == null) {
            AlertDialog.Builder(this)
                .setTitle("安装连接工具 Tailscale")
                .setMessage("1. 点击下方按钮下载官方安装包。\n2. 下载完成后，从浏览器的下载列表打开文件，按系统提示安装。若要求允许当前浏览器安装应用，确认来源后仅允许当前浏览器。\n3. 安装完成后返回本页，按钮会变为“打开 Tailscale”。\n\n不需要 Google 商店账号或 Tailscale 账号。若下载或安装受阻，请联系邀请你的运营人员；不要关闭手机的安全保护或下载来源不明的软件。")
                .setPositiveButton("下载官方安装包") { _, _ ->
                    openExternal("https://pkgs.tailscale.com/stable/tailscale-android-universal-1.102.4.apk", "暂时无法打开下载，请联系邀请你的运营人员。")
                }
                .setNegativeButton("返回", null)
                .show()
        }
        else runCatching { startActivity(launch) }.onFailure {
            Toast.makeText(this, "暂时无法打开，请从手机应用列表打开 Tailscale。", Toast.LENGTH_LONG).show()
        }
    }

    private fun openNetworkClient(packageName: String, name: String) {
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        if (launch == null) {
            AlertDialog.Builder(this).setTitle("准备 $name")
                .setMessage("请联系邀请你的运营人员提供已核验的安装包和本机配置。安装时按系统提示确认来源；不要下载来源不明的文件。安装完成后返回本页检查。")
                .setPositiveButton("知道了", null).show()
        } else runCatching { startActivity(launch) }.onFailure {
            Toast.makeText(this, "暂时无法打开，请从手机应用列表打开 $name。", Toast.LENGTH_LONG).show()
        }
    }

    private fun openPreparationSetting(action: String, fallback: String) {
        // Keep Settings separate for ordinary navigation. A live pairing
        // dialog still closes on app switching; use notification input.
        runCatching { startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.onFailure {
            runCatching { startActivity(Intent(android.provider.Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            Toast.makeText(this, fallback, Toast.LENGTH_LONG).show()
        }
    }

    private fun openOwnAppSettings() {
        val intent = Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(android.net.Uri.fromParts("package", packageName, null))
        runCatching { startActivity(intent) }.onFailure {
            runCatching { startActivity(Intent(android.provider.Settings.ACTION_SETTINGS)) }
                .onFailure { Toast.makeText(this, "无法打开系统设置；请从系统设置的应用列表中找到 SocialGrowth。", Toast.LENGTH_LONG).show() }
        }
    }

    private fun openExternal(url: String, fallbackMessage: String) {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url))) }
            .onFailure { Toast.makeText(this, fallbackMessage, Toast.LENGTH_LONG).show() }
    }

    private fun submitInstallationPause(
        deviceId: UUID,
        status: TextView,
        button: Button,
        request: DeviceControlRequest = DeviceControlRequest.create(),
    ) {
        val identity = installationStore.load()
        val token = identity?.activeSessionToken()
        if (token == null) {
            status.text = "本机身份会话已失效，暂停请求未发送。请重新核对本机身份。"
            button.isEnabled = false
            return
        }
        button.isEnabled = false
        status.text = "正在请求暂停；手机停止状态仍待独立确认。"
        val client = DeviceControlApiClient(BuildConfig.API_BASE_URL)
        runNetwork(
            action = {
                try {
                    ControlAttempt(client.pauseInstallation(token, deviceId, request), requestAccepted = true, knownRejected = false)
                } catch (error: Exception) {
                    val response = (error as? DeviceControlRequestException)
                    if (response != null && response.status in 400..499) {
                        ControlAttempt(null, requestAccepted = false, knownRejected = true)
                    } else {
                        val current = runCatching { client.installation(token, deviceId) }.getOrNull()
                        ControlAttempt(current, requestAccepted = current?.requestId == request.requestId, knownRejected = false)
                    }
                }
            },
            success = { attempt ->
                if (attempt.fact != null) status.text = controlStatusText(attempt.fact)
                if (attempt.requestAccepted) {
                    button.text = if (attempt.fact?.stop == "confirmed") "本机已确认停止" else "暂停请求处理中"
                    button.isEnabled = false
                } else if (attempt.knownRejected) {
                    status.text = "暂停请求未受理；本机状态没有被标记为已暂停。请刷新后重试。"
                    button.text = "重新请求暂停"
                    button.isEnabled = true
                    button.setOnClickListener { submitInstallationPause(deviceId, status, button) }
                } else {
                    status.text = "本次请求结果仍无法确认；${attempt.fact?.let(::controlStatusText) ?: "尚未读取到服务端进展"}。可用同一请求核对。"
                    button.text = "核对同一暂停请求"
                    button.isEnabled = true
                    button.setOnClickListener { submitInstallationPause(deviceId, status, button, request) }
                }
            },
            failure = {
                status.text = "本次请求结果未知；未获得暂停受理或手机停止证明。可用同一请求核对。"
                button.text = "核对同一暂停请求"
                button.isEnabled = true
                button.setOnClickListener { submitInstallationPause(deviceId, status, button, request) }
            },
        )
    }

    private fun controlStatusText(fact: DeviceControlFact): String {
        val intent = when (fact.intent) {
            "active" -> "当前没有待处理的暂停请求"
            "pause_requested" -> "中心已记录暂停请求"
            "paused" -> "设备状态为暂停"
            "resume_requested" -> "恢复请求已记录，尚未恢复参与或权限"
            "exit_pending" -> "退出处理中"
            "exited" -> "设备已退出"
            else -> "控制状态无法识别"
        }
        val stop = when (fact.stop) {
            "not_requested" -> "尚未请求手机停止"
            "requested" -> "手机停止尚未确认"
            "confirmed" -> "可信停止事实已确认"
            "unknown" -> "手机停止状态未知"
            else -> "手机停止状态无法识别"
        }
        return "$intent；$stop；未决动作 ${fact.unresolvedActionCount}；核验时间 ${formatFactTime(fact.checkedAt.toString())}"
    }

    private fun showControlConfirmation(
        title: String,
        deviceLabel: String,
        impact: String,
        actionLabel: String = "确认暂停",
        onConfirm: () -> Unit,
    ) {
        val dialog = Dialog(this)
        val sheet = vertical(20).apply {
            background = GradientDrawable().apply {
                setColor(Color.WHITE)
                cornerRadii = floatArrayOf(dp(18).toFloat(), dp(18).toFloat(), dp(18).toFloat(), dp(18).toFloat(), 0f, 0f, 0f, 0f)
            }
            setPadding(dp(20), dp(22), dp(20), dp(24))
        }
        sheet.addView(label(title, 22f, ink, Typeface.BOLD), matchWrap())
        sheet.addView(label(deviceLabel, 16f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(14) })
        sheet.addView(label(impact, 15f, secondary), matchWrap().apply { topMargin = dp(8) })
        sheet.addView(primaryButton(actionLabel).apply {
            setOnClickListener { dialog.dismiss(); onConfirm() }
        }, matchHeight(54).apply { topMargin = dp(22) })
        sheet.addView(secondaryButton("取消").apply { setOnClickListener { dialog.dismiss() } }, matchHeight(50).apply { topMargin = dp(8) })
        dialog.setContentView(sheet)
        dialog.setCanceledOnTouchOutside(true)
        dialog.show()
        dialog.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT)
            attributes = attributes.apply { gravity = Gravity.BOTTOM; dimAmount = 0.32f }
            addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        }
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
        root.addView(secondaryButton("检查网络与无线调试").apply {
            setOnClickListener { showInstallationNetworkGuide(null) { showInstallationLoading() } }
        }, matchHeight(50).apply { topMargin = dp(10) })
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

    private fun showAssociationCodeInput(session: StoredProviderSession) {
        val codeInput = editText("sgassoc_v1_…", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD).apply {
            contentDescription = "执行手机关联码"
            isSingleLine = true
            importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("输入执行手机关联码")
            .setMessage("请从专用执行手机的关联页面输入代码。核对目标后仍需明确确认关联。")
            .setView(codeInput)
            .setNegativeButton("取消", null)
            .setPositiveButton("核对设备", null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val code = codeInput.text.toString().trim()
                if (!code.matches(Regex("^sgassoc_v1_[A-Za-z0-9_-]{43}$"))) {
                    codeInput.error = "请输入有效的执行手机关联码"
                    return@setOnClickListener
                }
                dialog.dismiss()
                handleAssociationPayload(
                    JSONObject()
                        .put("contractVersion", ProviderApiClient.CONTRACT_VERSION)
                        .put("associationCode", code)
                        .toString(),
                )
            }
        }
        dialog.show()
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
        local: Boolean = false,
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
        root.addView(backHeader(if (local) "接入这台手机" else "添加其他手机", leaveConfirmation), matchWrap())
        root.addView(label(if (local) "确认关联本机" else "核对关联设备", 29f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(20) })
        root.addView(label(if (local) "将正在使用的这台手机关联到你的管理账号。" else "已识别关联码，请核对目标手机。", 15f, secondary), matchWrap().apply { topMargin = dp(7) })
        val device = vertical(18).apply { background = rounded(Color.WHITE, 12); elevation = dp(2).toFloat() }
        device.addView(label(inspection.deviceLabel, 20f, ink, Typeface.BOLD))
        device.addView(detailRow("当前提供者", session.displayName), matchWrap().apply { topMargin = dp(18) })
        device.addView(detailRow("验证手机号", session.phoneHint), matchWrap().apply { topMargin = dp(12) })
        device.addView(detailRow("目标设备", inspection.deviceLabel), matchWrap().apply { topMargin = dp(12) })
        device.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        device.addView(label(if (local) "本机 ${shortDeviceName()} · 安装标识尾号 ${inspection.installationId.toString().takeLast(8)}" else "请核对执行手机上显示的设备标识。", 13f, secondary))
        root.addView(device, matchWrap().apply { topMargin = dp(20) })
        val providerDeviceLabel = editText("设备备注名（选填）", android.text.InputType.TYPE_CLASS_TEXT).apply {
            maxLines = 1
            filters = arrayOf(android.text.InputFilter.LengthFilter(100))
            contentDescription = "设备备注名，可选"
        }
        root.addView(providerDeviceLabel, matchHeight(54).apply { topMargin = dp(14) })
        root.addView(label("留空时沿用执行手机的名称；该名称仅用于你自己的设备列表。", 13f, secondary), matchWrap().apply { topMargin = dp(6) })
        root.addView(label("关联后还需要", 18f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(24) })
        val next = vertical(18).apply { background = rounded(Color.WHITE, 12) }
        next.addView(explanationRow("1", if (local) "按引导连接业务网络" else "完成平台账号授权"))
        next.addView(explanationRow("2", if (local) "允许远程连接并确认连接结果" else "检查目标主页或频道权限"), matchWrap().apply { topMargin = dp(14) })
        next.addView(explanationRow("3", "完成授权与接入检查后才能执行任务"), matchWrap().apply { topMargin = dp(14) })
        root.addView(next, matchWrap().apply { topMargin = dp(12) })
        val error = label("", 13f, danger).apply { visibility = View.GONE }
        root.addView(error, matchWrap().apply { topMargin = dp(12) })
        val confirmText = if (local) "确认关联本机" else "确认关联这台执行手机"
        val confirm = primaryButton(confirmText).apply {
            id = R.id.association_confirm
            setOnClickListener {
                isEnabled = false
                text = "正在确认…"
                confirmationSubmitted = true
                providerDeviceLabel.isEnabled = false
                error.visibility = View.GONE
                runManagementNetwork(session, generation,
                    action = {
                        associationApi.result(session.sessionToken, inspection)
                            ?: associationApi.confirm(
                                session.sessionToken,
                                inspection,
                                associationConfirmKey,
                                providerDeviceLabel.text.toString().trim().takeIf(String::isNotEmpty),
                            )
                    },
                    success = { receipt -> showAssociationSuccess(session, receipt, local) },
                    failure = { message ->
                        isEnabled = true
                        text = confirmText
                        showError(error, message)
                    },
                )
            }
        }
        root.addView(confirm, matchHeight(54).apply { topMargin = dp(18) })
        root.addView(secondaryButton("重新扫码").apply {
            id = R.id.association_rescan
            visibility = if (local) View.GONE else View.VISIBLE
            setOnClickListener {
                if (confirmationSubmitted) {
                    Toast.makeText(this@MainActivity, "上次确认可能仍在处理中，稍后到设备页刷新核对。", Toast.LENGTH_LONG).show()
                }
                startAssociationScan()
            }
        }, matchHeight(52).apply { topMargin = dp(10) })
        root.addView(label(if (local) "关联后仍由你确认连接与执行准备；此操作不会立即开始任务。" else "此操作只关联目标手机。", 13f, secondary).apply {
            gravity = Gravity.CENTER
        }, matchWrap().apply { topMargin = dp(13) })
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        setContentView(scroll)
        guardManagementExpiry(session, generation)
    }

    private fun showAssociationSuccess(session: StoredProviderSession, receipt: AssociationReceipt, local: Boolean = false) {
        val generation = ++screenGeneration
        backAction = { showManagement(session) }
        val root = vertical(24).apply { setBackgroundColor(canvas); gravity = Gravity.CENTER_HORIZONTAL }
        root.addView(label("✓", 54f, Color.rgb(20, 108, 67), Typeface.BOLD), wrapWrap().apply { topMargin = dp(92) })
        root.addView(label("设备关联成功", 28f, ink, Typeface.BOLD), wrapWrap().apply { topMargin = dp(16) })
        root.addView(label("设备已进入待授权状态。", 15f, secondary), wrapWrap().apply { topMargin = dp(9) })
        root.addView(label("后续仍需完成平台授权与接入检查。", 14f, secondary), wrapWrap().apply { topMargin = dp(16) })
        if (local) root.addView(primaryButton("继续准备网络与连接").apply {
            setOnClickListener { showInstallationLoading(localProvider = session) }
        }, matchHeight(54).apply { topMargin = dp(24) })
        root.addView(primaryButton("返回设备管理").apply { setOnClickListener { showManagement(session) } }, matchHeight(54).apply { topMargin = dp(28) })
        setContentView(root)
        guardManagementExpiry(session, generation)
    }

    private fun renderDevices(container: LinearLayout, devices: List<ProviderDevice>, session: StoredProviderSession) {
        container.removeAllViews()
        val activeDevices = devices.filter { it.state != "exited" }
        val exitedDevices = devices.filter { it.state == "exited" }
        if (activeDevices.isEmpty()) {
            container.addView(label(if (exitedDevices.isEmpty()) "还没有关联的执行手机。" else "当前没有参与中的执行手机。", 14f, secondary), matchWrap().apply { topMargin = dp(12) })
        }
        activeDevices.forEach { device ->
            val row = vertical(16).apply {
                background = rounded(Color.WHITE, 12)
                minimumHeight = dp(96)
                isClickable = true
                isFocusable = true
                contentDescription = "查看${device.displayName}详情，${DeviceFactPresentation.state(device.state)}"
                setOnClickListener { showProviderDeviceDetail(session, device.deviceId) }
            }
            row.addView(label(device.displayName, 18f, ink, Typeface.BOLD))
            row.addView(label("设备标识尾号 ${device.deviceId.toString().takeLast(8)}", 12f, secondary), matchWrap().apply { topMargin = dp(4) })
            row.addView(label(DeviceFactPresentation.state(device.state), 14f, secondary), matchWrap().apply { topMargin = dp(7) })
            val liveConnection = ConnectionStatusView(this, false, device.state)
            row.addView(liveConnection, matchWrap().apply { topMargin = dp(12) })
            observeConnection(liveConnection, screenGeneration, session) {
                DeviceConnectionApiClient(api).providerState(session.sessionToken, device.deviceId)
            }
            container.addView(row, matchWrap().apply { topMargin = dp(10) })
        }
        if (exitedDevices.isNotEmpty()) {
            container.addView(secondaryButton("已退出设备 · ${exitedDevices.size}${if (exitedDevicesExpanded) "（收起）" else "（展开）"}").apply {
                contentDescription = "${if (exitedDevicesExpanded) "收起" else "展开"}已退出设备，共${exitedDevices.size}台"
                setOnClickListener {
                    exitedDevicesExpanded = !exitedDevicesExpanded
                    renderDevices(container, devices, session)
                }
            }, matchHeight(52).apply { topMargin = dp(18) })
            if (exitedDevicesExpanded) exitedDevices.forEach { device ->
                val row = vertical(16).apply {
                    background = rounded(Color.WHITE, 12)
                    minimumHeight = dp(96)
                    isClickable = true
                    isFocusable = true
                    contentDescription = "查看已退出设备${device.displayName}清理进展"
                    setOnClickListener { showProviderDeviceDetail(session, device.deviceId) }
                }
                row.addView(label(device.displayName, 18f, ink, Typeface.BOLD))
                row.addView(label("已退出 · ${DeviceFactPresentation.observation(device.lastObservedAt)}", 14f, secondary), matchWrap().apply { topMargin = dp(7) })
                container.addView(row, matchWrap().apply { topMargin = dp(10) })
            }
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
                } else renderProviderDeviceDetail(detail, session, current)
            },
            failure = { message ->
                detail.removeAllViews()
                detail.addView(label(message, 14f, danger), matchWrap().apply { topMargin = dp(24) })
            },
        )
    }

    private fun renderProviderDeviceDetail(container: LinearLayout, session: StoredProviderSession, device: ProviderDevice) {
        container.addView(label(device.displayName, 30f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(20) })
        container.addView(label("执行手机 · ${DeviceFactPresentation.state(device.state)}", 15f, secondary), matchWrap().apply { topMargin = dp(6) })
        container.addView(label("设备标识 ${device.deviceId}", 12f, secondary), matchWrap().apply { topMargin = dp(4) })
        val facts = vertical(16).apply { background = rounded(Color.WHITE, 12) }
        facts.addView(label("当前事实", 18f, ink, Typeface.BOLD))
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        facts.addView(detailRow("归属状态", DeviceFactPresentation.state(device.state)))
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        val liveConnection = ConnectionStatusView(this, true, device.state)
        facts.addView(liveConnection, matchWrap())
        observeConnection(liveConnection, screenGeneration, session) {
            DeviceConnectionApiClient(api).providerState(session.sessionToken, device.deviceId)
        }
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        facts.addView(detailRow("最近观察", if (device.lastObservedAt == null) "暂无" else formatFactTime(device.lastObservedAt)))
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(14); bottomMargin = dp(14) })
        facts.addView(detailRow("事实更新时间", formatFactTime(device.updatedAt)))
        container.addView(facts, matchWrap().apply { topMargin = dp(20) })
        container.addView(primaryButton("连接这台执行手机").apply {
            isEnabled = device.state in setOf("associated_pending_access", "access_ready")
            setOnClickListener { showProviderDeviceConnection(session, device) }
        }, matchHeight(52).apply { topMargin = dp(12) })
        container.addView(secondaryButton("修改设备备注名").apply {
            setOnClickListener { showRenameProviderDeviceDialog(session, device) }
        }, matchHeight(50).apply { topMargin = dp(12) })
        container.addView(label(DeviceFactPresentation.ACCESS_BOUNDARY, 14f, secondary), matchWrap().apply { topMargin = dp(18) })
        container.addView(label("查看详情不会申请控制，也不会改变手机状态。当前没有权威项目、发布身份或平台授权资料。", 13f, secondary), matchWrap().apply { topMargin = dp(10) })
        renderProviderControlPanel(container, session, device)
    }

    private fun showProviderDeviceConnection(session: StoredProviderSession, device: ProviderDevice, local: Boolean = false) {
        val screen = ++screenGeneration
        backAction = { showProviderDeviceDetail(session, device.deviceId) }
        val root = vertical(20).apply { setBackgroundColor(canvas) }
        root.addView(backHeader("连接执行手机") { showProviderDeviceDetail(session, device.deviceId) }, matchWrap())
        root.addView(label(device.displayName, 27f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(20) })
        root.addView(label("设备标识尾号 ${device.deviceId.toString().takeLast(8)}", 14f, secondary), matchWrap().apply { topMargin = dp(6) })
        root.addView(label(if (local) "正在连接本机。请先开始连接检查，再在系统“无线调试”页面选择“使用配对码配对设备”。" else "请先核对手边的执行手机。在那台手机完成业务网络连接并开启无线调试，再选择“使用配对码配对设备”。", 16f, ink), matchWrap().apply { topMargin = dp(20) })
        root.addView(label(if (local) "保持系统配对弹窗打开，下拉并展开 SocialGrowth 通知，点击“输入配对码”填写 6 位数字并发送；看到结果后再返回这里。切换应用会使配对码失效。" else "保持执行手机的配对弹窗打开，在这里输入 6 位配对码。每台手机单独配对；已经连接的手机不必重复操作。", 15f, secondary), matchWrap().apply { topMargin = dp(10) })
        val status = label("正在检查连接…", 16f, blue)
        status.accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        root.addView(status, matchWrap().apply { topMargin = dp(22) })
        val submit = primaryButton("输入配对码").apply { isEnabled = false; visibility = if (local) View.GONE else View.VISIBLE }
        root.addView(submit, matchHeight(54).apply { topMargin = dp(18) })
        val refresh = secondaryButton("重新检查")
        root.addView(refresh, matchHeight(50).apply { topMargin = dp(10) })
        val client = DeviceConnectionApiClient(api)
        var current: DeviceConnectionSnapshot? = null
        var busy = false
        fun check() {
            if (busy || screen != screenGeneration) return
            busy = true
            submit.isEnabled = false
            status.text = "正在检查连接…"
            runNetwork(action = { client.providerState(session.sessionToken, device.deviceId) }, success = { fact ->
                busy = false
                if (screen != screenGeneration) return@runNetwork
                current = fact
                status.text = DeviceConnectionBoundary.message(fact)
                submit.visibility = if (fact.connected || local) View.GONE else View.VISIBLE
                submit.isEnabled = fact.networkState in setOf("admitted", "pilot_verified") && fact.pairingState == "awaiting_code"
            }, failure = {
                busy = false
                if (screen != screenGeneration) return@runNetwork
                current = null
                status.text = "暂时无法检查这台手机的连接，请稍后重试。"
            })
        }
        submit.setOnClickListener {
            val target = current ?: return@setOnClickListener
            val input = editText("6 位配对码", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD).apply {
                isSaveEnabled = false
                importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
                filters = arrayOf(android.text.InputFilter.LengthFilter(6))
            }
            val error = label("", 14f, danger)
            val content = vertical(18).apply {
                addView(label("${device.displayName} · ${device.deviceId.toString().takeLast(8)}", 16f, ink, Typeface.BOLD), matchWrap())
                addView(input, matchHeight(54).apply { topMargin = dp(12) })
                addView(error, matchWrap().apply { topMargin = dp(8) })
            }
            val dialog = AlertDialog.Builder(this).setTitle("输入执行手机上的配对码")
                .setView(content).setNegativeButton("取消", null).setPositiveButton("确认配对", null).create()
            dialog.setOnDismissListener { input.text.clear() }
            dialog.setOnShowListener {
                dialog.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                    val code = input.text.toString()
                    if (!code.matches(Regex("^[0-9]{6}$"))) {
                        error.text = "请输入执行手机当前显示的 6 位数字。"
                        return@setOnClickListener
                    }
                    val request = "android-pair-${UUID.randomUUID()}"
                    input.text.clear()
                    dialog.dismiss()
                    submit.isEnabled = false
                    refresh.isEnabled = false
                    busy = true
                    status.text = "正在配对，请保持执行手机的弹窗打开…"
                    runNetwork(action = { client.pair(session.sessionToken, target, code, request) }, success = {
                        busy = false
                        if (screen == screenGeneration) { refresh.isEnabled = true; check() }
                    }, failure = {
                        busy = false
                        if (screen == screenGeneration) {
                            refresh.isEnabled = true
                            current = null
                            status.text = "本次配对结果尚未确认，请先重新检查。配对码已清除，不会自动重复提交。"
                        }
                    })
                }
            }
            dialog.show()
        }
        refresh.setOnClickListener { check() }
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        })
        check()
    }

    private fun showRenameProviderDeviceDialog(session: StoredProviderSession, device: ProviderDevice) {
        val loadedCommand = runCatching { deviceLabelCommandStore.load(session.providerId, device.deviceId) }
        var pendingCommand = loadedCommand.getOrNull()
        val pendingReadFailed = loadedCommand.isFailure
        val input = editText("设备备注名", InputType.TYPE_CLASS_TEXT).apply {
            setText(pendingCommand?.displayName ?: device.displayName)
            filters = arrayOf(android.text.InputFilter.LengthFilter(100))
            maxLines = 1
            isEnabled = pendingCommand == null && !pendingReadFailed
        }
        val error = label("", 13f, danger).apply { visibility = View.GONE }
        val content = vertical(10).apply {
            addView(input, matchHeight(52))
            addView(error, matchWrap())
        }
        val dialog = AlertDialog.Builder(this)
            .setTitle("修改设备备注名")
            .setMessage("只修改你本人设备列表中的名称。")
            .setView(content)
            .setNegativeButton("取消", null)
            .setPositiveButton(if (pendingCommand == null) "保存" else "用同一请求重试", null)
            .setNeutralButton("核实当前事实", null)
            .create()
        var requestInFlight = false
        dialog.setOnShowListener {
            val saveButton = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
            val verifyButton = dialog.getButton(AlertDialog.BUTTON_NEUTRAL)
            val cancelButton = dialog.getButton(AlertDialog.BUTTON_NEGATIVE)
            if (pendingReadFailed) {
                error.text = "存在无法读取的改名请求记录；为避免重复修改，请先刷新设备事实。"
                error.visibility = View.VISIBLE
                saveButton.isEnabled = false
                verifyButton.isEnabled = false
                cancelButton.isEnabled = false
                return@setOnShowListener
            }
            if (pendingCommand != null) {
                error.text = "上次改名结果尚未确认；原名称、事实版本和请求键已冻结。可核实当前事实或接续原请求。"
                error.visibility = View.VISIBLE
            } else {
                verifyButton.isEnabled = false
            }
            fun setUnresolved(command: ProviderDeviceLabelCommand, message: String) {
                requestInFlight = false
                pendingCommand = command
                input.setText(command.displayName)
                input.isEnabled = false
                error.text = message
                error.visibility = View.VISIBLE
                saveButton.text = "用同一请求重试"
                saveButton.isEnabled = true
                verifyButton.visibility = View.VISIBLE
                verifyButton.isEnabled = true
                cancelButton.isEnabled = true
                dialog.setCancelable(true)
                dialog.setCanceledOnTouchOutside(true)
            }
            fun setBusy(busy: Boolean) {
                requestInFlight = busy
                saveButton.isEnabled = !busy
                verifyButton.isEnabled = !busy && pendingCommand != null
                cancelButton.isEnabled = !busy
                dialog.setCancelable(!busy)
                dialog.setCanceledOnTouchOutside(!busy)
            }
            fun finishReconciled(command: ProviderDeviceLabelCommand, latest: ProviderDevice) {
                if (!deviceLabelCommandStore.archiveAfterFactAdvance(command, latest)) {
                    setUnresolved(command, "服务端事实已读取，但本机请求记录未能解除锁定；请稍后重新核实。")
                    return
                }
                pendingCommand = null
                dialog.dismiss()
                val message = if (latest.displayName == command.displayName) {
                    "原请求结果仍未知；当前设备名称与目标一致。已保留原请求记录，可基于最新事实开始新的明确编辑。"
                } else {
                    "原请求结果仍未知；已读取更新后的设备事实。原请求已冻结归档，可基于最新事实开始新的明确编辑。"
                }
                Toast.makeText(this@MainActivity, message, Toast.LENGTH_LONG).show()
                showProviderDeviceDetail(session, latest.deviceId)
            }
            fun reconcile(command: ProviderDeviceLabelCommand) {
                if (requestInFlight) return
                setBusy(true)
                error.text = "正在读取本人当前设备事实；不会重复提交改名。"
                error.visibility = View.VISIBLE
                runManagementNetwork(session, screenGeneration,
                    action = {
                        val latest = associationApi.devices(session.sessionToken).firstOrNull { it.deviceId == command.deviceId }
                        DeviceLabelAttempt(latest, null)
                    },
                    success = { result ->
                        val latest = result.device
                        if (latest == null) {
                            setUnresolved(command, "当前本人设备清单中无法核实此设备；原请求仍被冻结。")
                        } else if (latest.factVersion == command.expectedFactVersion + 1L && latest.displayName == command.displayName) {
                            finishReconciled(command, latest)
                        } else if (latest.factVersion > command.expectedFactVersion) {
                            finishReconciled(command, latest)
                        } else {
                            setUnresolved(command, "当前事实尚未变化，原请求仍可能在处理中；请用同一请求重试或稍后重新核实。")
                        }
                    },
                    failure = {
                        setUnresolved(command, "当前设备事实暂时无法核实；原请求仍被冻结，请稍后重试核实。")
                    },
                )
            }
            saveButton.setOnClickListener {
                if (requestInFlight) return@setOnClickListener
                val command = pendingCommand ?: run {
                    val name = input.text.toString().trim()
                    if (name.isEmpty() || name.length > 100) {
                        error.text = "请输入 1 到 100 个字符。"
                        error.visibility = View.VISIBLE
                        return@setOnClickListener
                    }
                    ProviderDeviceLabelCommand.create(session.providerId, device, name).also { created ->
                        if (!deviceLabelCommandStore.save(created)) {
                            error.text = "无法安全保存本次请求；没有发送改名操作。"
                            error.visibility = View.VISIBLE
                            return@setOnClickListener
                        }
                        pendingCommand = created
                        input.isEnabled = false
                    }
                }
                setBusy(true)
                error.text = "正在提交改名；期间不会发送另一请求。"
                error.visibility = View.VISIBLE
                runManagementNetwork(session, screenGeneration,
                    action = {
                        try {
                            DeviceLabelAttempt(associationApi.renameDevice(session.sessionToken, device, command), null)
                        } catch (failure: ProviderApiException) {
                            if (failure.code == "AUTHENTICATION_REQUIRED" || failure.code == "PROVIDER_DISABLED") throw failure
                            DeviceLabelAttempt(null, failure.code)
                        } catch (_: Exception) {
                            DeviceLabelAttempt(null, null)
                        }
                    },
                    success = { attempt ->
                        val updated = attempt.device
                        if (updated != null) {
                            if (updated.displayName == command.displayName && updated.factVersion == command.expectedFactVersion + 1L
                                && deviceLabelCommandStore.clear(command)) {
                                pendingCommand = null
                                dialog.dismiss()
                                Toast.makeText(this@MainActivity, "设备名称已更新。", Toast.LENGTH_SHORT).show()
                                showProviderDeviceDetail(session, updated.deviceId)
                            } else setUnresolved(command, "服务响应与原请求或本机锁定记录不一致；请核实当前事实后再继续。")
                        } else {
                            val message = when (attempt.errorCode) {
                                "FACT_VERSION_STALE" -> "设备事实版本已变化；核实当前事实后再继续。原请求保持冻结。"
                                "IDEMPOTENCY_KEY_REUSED" -> "服务端报告原请求键冲突；结果仍需核实，不会生成新请求。"
                                "AUTHORIZATION_DENIED" -> "当前无法确认本人仍拥有这台设备；原请求保持冻结。"
                                else -> "名称尚未确认保存；可核实当前事实或用原请求键重试。"
                            }
                            setUnresolved(command, message)
                        }
                    },
                    failure = { setUnresolved(command, "名称结果未知；原名称、事实版本与请求键已冻结。请核实当前事实或接续原请求。") },
                )
            }
            verifyButton.setOnClickListener {
                pendingCommand?.let(::reconcile)
            }
            if (pendingCommand == null) {
                verifyButton.visibility = View.GONE
                cancelButton.isEnabled = true
            } else {
                verifyButton.visibility = View.VISIBLE
            }
        }
        dialog.show()
    }

    private fun renderProviderControlPanel(container: LinearLayout, session: StoredProviderSession, device: ProviderDevice) {
        val panel = vertical(16).apply { background = rounded(Color.WHITE, 12) }
        panel.addView(label("暂停与现场协助", 18f, ink, Typeface.BOLD))
        val status = label("正在读取控制进展…", 14f, secondary)
        panel.addView(status, matchWrap().apply { topMargin = dp(10) })
        val actions = vertical(10)
        val pause = primaryButton("暂停这台手机").apply {
            isEnabled = device.state !in setOf("paused", "exit_pending", "exited")
            setOnClickListener {
                showControlConfirmation(
                    "暂停这台手机",
                    device.displayName,
                    "停止接新任务，当前操作会尽快停止；恢复需要在管理手机上申请。",
                ) { submitProviderControl(device, session, "pause", status, this) }
            }
        }
        actions.addView(pause, matchHeight(52))
        if (device.state == "paused") {
            actions.addView(secondaryButton("请求恢复").apply {
                setOnClickListener {
                    showControlConfirmation(
                        "请求恢复这台手机",
                        device.displayName,
                        "系统将重新核对当前授权和设备条件。此请求不会自动恢复本机参与或执行权限。",
                        actionLabel = "确认请求恢复",
                    ) { submitProviderControl(device, session, "resume", status, pause) }
                }
            }, matchHeight(52))
        }
        panel.addView(actions, matchWrap().apply { topMargin = dp(12) })
        panel.addView(secondaryButton("刷新控制进展").apply {
            setOnClickListener { loadProviderControl(device, session, status, pause) }
        }, matchHeight(48).apply { topMargin = dp(8) })
        container.addView(panel, matchWrap().apply { topMargin = dp(20) })
        loadProviderControl(device, session, status, pause)
    }

    private fun loadProviderControl(device: ProviderDevice, session: StoredProviderSession, status: TextView, pause: Button) {
        status.text = "正在读取控制进展…"
        runNetwork(
            action = { DeviceControlApiClient(BuildConfig.API_BASE_URL).provider(device.deviceId, session.sessionToken) },
            success = { fact ->
                status.text = controlStatusText(fact)
                if (fact.intent in setOf("pause_requested", "paused", "resume_requested", "exit_pending", "exited")) {
                    pause.isEnabled = false
                    pause.text = if (fact.stop == "confirmed") "手机停止已确认" else "控制请求处理中"
                }
            },
            failure = { status.text = "当前控制进展无法确认；不要把此状态视为暂停或可执行。" },
        )
    }

    private fun submitProviderControl(
        device: ProviderDevice,
        session: StoredProviderSession,
        action: String,
        status: TextView,
        button: Button,
        request: DeviceControlRequest = DeviceControlRequest.create(),
    ) {
        button.isEnabled = false
        status.text = if (action == "pause") "正在请求暂停；手机停止状态仍待独立确认。" else "正在请求恢复；参与与执行权限仍待独立复核。"
        val client = DeviceControlApiClient(BuildConfig.API_BASE_URL)
        runNetwork(
            action = {
                try {
                    val fact = if (action == "pause") client.pauseProvider(device.deviceId, session.sessionToken, request)
                    else client.resumeProvider(device.deviceId, session.sessionToken, request)
                    ControlAttempt(fact, requestAccepted = true, knownRejected = false)
                } catch (error: Exception) {
                    val response = error as? DeviceControlRequestException
                    if (response != null && response.status in 400..499) {
                        ControlAttempt(null, requestAccepted = false, knownRejected = true)
                    } else {
                        val current = runCatching { client.provider(device.deviceId, session.sessionToken) }.getOrNull()
                        ControlAttempt(current, requestAccepted = current?.requestId == request.requestId, knownRejected = false)
                    }
                }
            },
            success = { attempt ->
                attempt.fact?.let { status.text = controlStatusText(it) }
                if (attempt.requestAccepted) {
                    button.isEnabled = false
                    button.text = "请求已记录；等待状态复核"
                } else if (attempt.knownRejected) {
                    status.text = "该控制请求未受理；设备状态未改变。请刷新后核对。"
                    button.text = if (action == "pause") "重新请求暂停" else "重新请求恢复"
                    button.isEnabled = true
                    button.setOnClickListener { submitProviderControl(device, session, action, status, button) }
                } else {
                    status.text = "原请求结果无法确认；${attempt.fact?.let(::controlStatusText) ?: "尚未读取到服务端进展"}。可用同一请求核对。"
                    button.text = "核对同一请求"
                    button.isEnabled = true
                    button.setOnClickListener { submitProviderControl(device, session, action, status, button, request) }
                }
            },
            failure = {
                status.text = "请求结果未知；没有证明手机已停止或已恢复。可用同一请求核对。"
                button.text = "核对同一请求"
                button.isEnabled = true
                button.setOnClickListener { submitProviderControl(device, session, action, status, button, request) }
            },
        )
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
        root.addView(secondaryButton("退出管理登录").apply {
            setOnClickListener { logoutManagement(session, this) }
        }, matchHeight(54).apply { topMargin = dp(30) })
        root.addView(label("退出管理登录不暂停或退出任何已关联执行手机。", 13f, secondary), matchWrap().apply { topMargin = dp(8) })
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        val page = vertical(0).apply {
            setBackgroundColor(canvas)
            addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(providerNavigation(session, "profile"), matchWrap())
        }
        setContentView(page)
        guardManagementExpiry(session, generation)
    }

    private fun showProviderCommission(session: StoredProviderSession, after: CommissionCursor? = null) {
        val generation = ++screenGeneration
        backAction = { showManagement(session) }
        val root = vertical(20).apply { setBackgroundColor(canvas) }
        root.addView(appHeader("仅管理"), matchWrap())
        root.addView(label("分佣", 30f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(22) })
        root.addView(label("本人收入与佣金记录", 15f, secondary), matchWrap().apply { topMargin = dp(6) })
        val estimated = vertical(14).apply { background = rounded(Color.WHITE, 12) }
        estimated.addView(label("平台预估收益", 17f, ink, Typeface.BOLD))
        estimated.addView(label("暂无可信的本人可归属预估数据；不会从佣金记录或设备数量推算。", 14f, secondary), matchWrap().apply { topMargin = dp(6) })
        root.addView(estimated, matchWrap().apply { topMargin = dp(18) })
        root.addView(label("佣金记录", 18f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(22) })
        val records = vertical(12)
        val recordStatus = label("正在读取本人佣金记录…", 14f, secondary)
        records.addView(recordStatus, matchWrap())
        root.addView(records, matchWrap().apply { topMargin = dp(10) })
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        val page = vertical(0).apply {
            setBackgroundColor(canvas)
            addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(providerNavigation(session, "commission"), matchWrap())
        }
        setContentView(page)
        guardManagementExpiry(session, generation)
        runNetwork(
            action = { CommissionApiClient(BuildConfig.API_BASE_URL).list(session.sessionToken, after) },
            success = { response ->
                if (generation != screenGeneration) return@runNetwork
                records.removeAllViews()
                if (response.records.isEmpty()) {
                    records.addView(label("当前没有可读取的本人历史佣金计算记录。", 14f, secondary), matchWrap())
                } else response.records.forEach { record ->
                    val card = vertical(14).apply {
                        background = rounded(Color.WHITE, 12)
                        isClickable = true
                        isFocusable = true
                        contentDescription = "打开${commissionPlatform(record.platform)}内部佣金计算记录"
                        setOnClickListener { showProviderCommissionDetail(session, record, after) }
                    }
                    card.addView(label("${commissionPlatform(record.platform)} · ${record.accountIdentityRef}", 17f, ink, Typeface.BOLD))
                    card.addView(label("收益期间 ${formatFactTime(record.productionStartsAt.toString())} – ${formatFactTime(record.productionEndsAt.toString())}", 13f, secondary), matchWrap().apply { topMargin = dp(6) })
                    card.addView(label("内部佣金计算参考 ${formatMinorUnits(record.commissionMinorUnits, record.minorUnitScale, record.currency)}", 15f, ink), matchWrap().apply { topMargin = dp(8) })
                    card.addView(label("${if (record.currentForIncome) "当前修订" else "历史修订"} · 付款事实未记录 · 不是应付或已付款", 13f, secondary), matchWrap().apply { topMargin = dp(5) })
                    records.addView(card, matchWrap().apply { topMargin = dp(10) })
                }
                response.nextAfter?.let { next -> records.addView(secondaryButton("下一页").apply {
                    setOnClickListener { showProviderCommission(session, next) }
                }, matchHeight(50).apply { topMargin = dp(14) }) }
            },
            failure = {
                if (generation != screenGeneration) return@runNetwork
                records.removeAllViews()
                records.addView(label("本人佣金记录暂时无法读取；没有显示推算金额。", 14f, danger), matchWrap())
                records.addView(secondaryButton("重试读取").apply {
                    setOnClickListener { showProviderCommission(session, after) }
                }, matchHeight(50).apply { topMargin = dp(10) })
            },
        )
    }

    private fun showProviderCommissionDetail(session: StoredProviderSession, record: ProviderCommissionRecord, after: CommissionCursor?) {
        val generation = ++screenGeneration
        backAction = { showProviderCommission(session, after) }
        val root = vertical(20).apply { setBackgroundColor(canvas) }
        root.addView(backHeader("佣金详情") { showProviderCommission(session, after) }, matchWrap())
        root.addView(label("${commissionPlatform(record.platform)} · ${record.accountIdentityRef}", 26f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(22) })
        root.addView(label("${if (record.currentForIncome) "当前修订" else "历史修订"} · 修订 ${record.revision}", 14f, secondary), matchWrap().apply { topMargin = dp(8) })
        val facts = vertical(14).apply { background = rounded(Color.WHITE, 12) }
        facts.addView(detailRow("收益所属期间", "${formatFactTime(record.productionStartsAt.toString())} – ${formatFactTime(record.productionEndsAt.toString())}"))
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(13); bottomMargin = dp(13) })
        facts.addView(detailRow("收到的平台收入", formatMinorUnits(record.receivedRevenueMinorUnits, record.minorUnitScale, record.currency)))
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(13); bottomMargin = dp(13) })
        facts.addView(detailRow("适用比例", "${record.appliedFraction} · 版本 ${record.rateVersion}"))
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(13); bottomMargin = dp(13) })
        facts.addView(detailRow("内部计算参考", formatMinorUnits(record.commissionMinorUnits, record.minorUnitScale, record.currency)))
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(13); bottomMargin = dp(13) })
        facts.addView(detailRow("计算规则", "${record.rounding} · 规则版本 ${record.moneyPolicyVersion}"))
        facts.addView(divider(), matchHeight(1).apply { topMargin = dp(13); bottomMargin = dp(13) })
        facts.addView(detailRow("收到时间", formatFactTime(record.receivedAt.toString())))
        facts.addView(detailRow("核算时间", formatFactTime(record.evaluatedAt.toString())), matchWrap().apply { topMargin = dp(10) })
        root.addView(facts, matchWrap().apply { topMargin = dp(20) })
        root.addView(label("此记录仅为内部计算。付款事实未记录；本页面不表示应付款项，也不能发起付款。", 14f, secondary), matchWrap().apply { topMargin = dp(18) })
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            addView(root, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        })
        guardManagementExpiry(session, generation)
    }

    private fun commissionPlatform(platform: String) = if (platform == "facebook") "Facebook" else "YouTube"

    private fun formatMinorUnits(minorUnits: String, scale: Int, currency: String): String {
        if (scale == 0) return "$currency $minorUnits"
        val padded = minorUnits.padStart(scale + 1, '0')
        return "$currency ${padded.dropLast(scale)}.${padded.takeLast(scale)}"
    }

    private fun providerNavigation(session: StoredProviderSession, selected: String): BottomNavigationView {
        val themed = ContextThemeWrapper(this, R.style.Theme_SocialGrowth_Navigation)
        return (LayoutInflater.from(themed).inflate(R.layout.provider_navigation, null) as BottomNavigationView).apply {
        setBackgroundColor(Color.WHITE)
        // The Activity root already handles system-bar safe areas.
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets -> insets }
        val colors = ColorStateList(arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()), intArrayOf(blue, secondary))
        itemIconTintList = colors
        itemTextColor = colors
        selectedItemId = when (selected) {
            "commission" -> R.id.tab_commission
            "profile" -> R.id.tab_profile
            else -> R.id.tab_devices
        }
        setOnItemReselectedListener { /* Keep current content and scroll position. */ }
        setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.tab_devices -> showManagement(session)
                R.id.tab_commission -> showProviderCommission(session)
                R.id.tab_profile -> showProviderProfile(session)
            }
            true
        }
        }
    }

    private fun observeConnection(panel: ConnectionStatusView, generation: Int, session: StoredProviderSession? = null,
                                  load: () -> DeviceConnectionSnapshot) {
        var busy = false
        var sequence = 0
        var lastAttempt = 0L
        var latest: DeviceConnectionSnapshot? = null
        var failed = false
        fun current() = generation == screenGeneration && panel.isAttachedToWindow &&
            lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) && !isFinishing && !isDestroyed
        fun visible() = panel.getGlobalVisibleRect(android.graphics.Rect())
        fun refresh() {
            if (!current() || busy) return
            busy = true; lastAttempt = android.os.SystemClock.elapsedRealtime()
            val attempt = ++sequence
            panel.render(if (panel.isFresh()) latest else null, failed, refreshing = true)
            val success: (DeviceConnectionSnapshot) -> Unit = { fact ->
                if (current() && sequence == attempt) { busy = false; failed = false; latest = fact; panel.accept(fact) }
            }
            val failure: (String) -> Unit = {
                if (current() && sequence == attempt) { busy = false; failed = true; latest = null; panel.render(null, failed = true) }
            }
            if (session != null) runManagementNetwork(session, generation, load, success, failure)
            else runNetwork(load, success, { failure("unavailable") })
        }
        val tick = object : Runnable {
            override fun run() {
                if (!current()) return
                if (!panel.isFresh()) panel.render(null, failed, busy)
                else panel.updateTimestamp()
                if (visible() && android.os.SystemClock.elapsedRealtime() - lastAttempt >= 5_000) refresh()
                mainHandler.postDelayed(this, 2_000)
            }
        }
        fun stop() { ++sequence; busy = false; latest = null; mainHandler.removeCallbacks(tick); panel.render(null) }
        fun start() { if (current()) { stop(); failed = false; lastAttempt = 0; tick.run() } }
        val observer = object : DefaultLifecycleObserver {
            override fun onResume(owner: LifecycleOwner) { start() }
            override fun onPause(owner: LifecycleOwner) { stop() }
        }
        panel.refreshAction = { refresh() }
        panel.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(v: View) { lifecycle.addObserver(observer) }
            override fun onViewDetachedFromWindow(v: View) { stop(); lifecycle.removeObserver(observer) }
        })
        if (panel.isAttachedToWindow) lifecycle.addObserver(observer)
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

    private fun detailRow(key: String, value: TextView) = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        addView(label(key, 14f, secondary), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        addView(value, wrapWrap())
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
