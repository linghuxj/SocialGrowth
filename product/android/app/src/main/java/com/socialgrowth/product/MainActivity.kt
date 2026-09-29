package com.socialgrowth.product

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
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
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.util.UUID
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val blue = Color.rgb(36, 89, 196)
    private val canvas = Color.rgb(244, 246, 250)
    private val ink = Color.rgb(23, 43, 77)
    private val secondary = Color.rgb(82, 97, 118)
    private val dividerColor = Color.rgb(220, 226, 234)
    private val danger = Color.rgb(180, 35, 24)
    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())
    private lateinit var api: ProviderApiClient
    private lateinit var sessionStore: ProviderSessionStore
    private var registrationMode = true
    private var invitationCode: String? = null
    private var challenge: PhoneVerificationChallenge? = null
    private var challengeKey = newIdempotencyKey("challenge")
    private var verifyKey = newIdempotencyKey("verify")
    private var authKey = newIdempotencyKey("auth")
    private var lastCode = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        api = ProviderApiClient(BuildConfig.API_BASE_URL)
        sessionStore = ProviderSessionStore(this)
        invitationCode = intent?.data?.getQueryParameter("invitation")
            ?: intent?.data?.getQueryParameter("code")
            ?: intent?.getStringExtra("invitation")
        sessionStore.load()?.let {
            showManagement(it)
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
        card.addView(label("注册不会将本机接入执行。", 13f, secondary).apply { gravity = Gravity.CENTER }, matchWrap().apply {
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
        root.addView(View(this), LinearLayout.LayoutParams(1, 0, 1f))
        root.addView(label("示例页面 · 2026-09-28", 12f, Color.rgb(122, 135, 151)).apply { gravity = Gravity.CENTER }, matchWrap().apply {
            topMargin = dp(24)
            bottomMargin = dp(10)
        })

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
        val content = vertical(24).apply {
            setBackgroundColor(canvas)
            gravity = Gravity.CENTER_HORIZONTAL
        }
        content.addView(label("SocialGrowth", 20f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(28) })
        content.addView(label("已进入管理", 30f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(60) })
        content.addView(label(session.displayName, 18f, ink, Typeface.BOLD), matchWrap().apply { topMargin = dp(20) })
        content.addView(label(session.phoneHint, 15f, secondary), matchWrap().apply { topMargin = dp(6) })
        val notice = vertical(18).apply { background = rounded(Color.WHITE, 12) }
        notice.addView(label("管理身份已验证", 16f, Color.rgb(20, 108, 67), Typeface.BOLD))
        notice.addView(label("登录不会将这台手机接入执行，也不会改变已有执行手机状态。", 14f, secondary), matchWrap().apply { topMargin = dp(8) })
        notice.addView(label("设备关联将在下一阶段从管理入口逐台确认。", 14f, secondary), matchWrap().apply { topMargin = dp(8) })
        content.addView(notice, matchWrap().apply { topMargin = dp(32) })
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
        content.addView(logout, matchHeight(54).apply { topMargin = dp(34) })
        setContentView(content)
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
