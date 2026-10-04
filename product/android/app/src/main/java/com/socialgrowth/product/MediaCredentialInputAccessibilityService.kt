package com.socialgrowth.product

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.net.LocalServerSocket
import android.net.LocalSocket
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.util.Base64
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * Explicitly enabled Android system service for sealed, one-use actions.
 * It fails closed until the trusted backend keyset/consume endpoints exist.
 */
class MediaCredentialInputAccessibilityService : AccessibilityService() {
    private val worker = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "sg-media-input-control").apply { isDaemon = true }
    }
    private val stopped = AtomicBoolean(false)
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var server: LocalServerSocket? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        serviceInfo = serviceInfo.apply {
            flags = flags or AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
            eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or AccessibilityEvent.TYPE_VIEW_FOCUSED
        }
        ParticipationService.underActionFenceLock { stopped.set(false) }
        worker.execute(::serveFailClosedControlChannel)
    }

    /** Never inspect event text, descriptions, source text, or node trees here. */
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Receiving an event is not authorization to observe or expose its contents.
    }

    override fun onInterrupt() {
        // Interrupt invalidates any in-flight control session. No automatic retry.
        ParticipationService.underActionFenceLock {
            stopped.set(true)
            runCatching { server?.close() }
            server = null
        }
    }

    override fun onDestroy() {
        ParticipationService.underActionFenceLock {
            stopped.set(true)
            runCatching { server?.close() }
            server = null
        }
        worker.shutdownNow()
        super.onDestroy()
    }

    private fun serveFailClosedControlChannel() {
        try {
            LocalServerSocket(LOCAL_SOCKET_NAME).use { listener ->
                server = listener
                while (!stopped.get()) {
                    val client = try { listener.accept() } catch (_: IOException) { break }
                    client.use(::handleOneConnection)
                }
            }
        } catch (_: Exception) {
            // No exception text or request data is logged. A missing channel is closed.
        } finally {
            server = null
        }
    }

    private fun handleOneConnection(socket: LocalSocket) {
        try {
            socket.soTimeout = SOCKET_TIMEOUT_MS
            val input = DataInputStream(socket.inputStream)
            val output = DataOutputStream(socket.outputStream)
            val helloBytes = readLengthDelimited(input, MAX_HELLO_BYTES) ?: return
            val scope = MediaCredentialInputScope.decodeHelloRequest(helloBytes)
            val identity = InstallationIdentityStore(this).load() ?: return
            if (!matchesCurrentInstallation(scope, identity)) return
            if (!ParticipationService.hasCurrentConfirmation()) return
            val targetPackage = when (scope.platform) {
                MediaAccountPlatform.FACEBOOK -> FACEBOOK_PACKAGE
                MediaAccountPlatform.YOUTUBE -> YOUTUBE_PACKAGE
            }
            if (scope.targetPackage != targetPackage) return

            val nonce = ByteArray(NONCE_BYTES).also(SecureRandom()::nextBytes)
            val deviceKeyPair = createEphemeralDeviceKeyPair()
            val proofInput = mediaHelloSignatureInput(helloBytes, nonce, deviceKeyPair.public.encoded)
            val signer = EnrollmentKeySigner(UUID.fromString(requireNotNull(identity.installationId)))
            val authorizationClient = MediaCredentialInputAuthorizationClient(BuildConfig.API_BASE_URL)
            authorizationClient.ensureExistingKeyEnrolled(
                installationToken = requireNotNull(identity.activeSessionToken()),
                installationId = UUID.fromString(requireNotNull(identity.installationId)),
                installationGeneration = requireNotNull(identity.generation),
                signer = signer,
            )
            val signature = signer.signExistingMediaInputProof(proofInput)
            val helloProof = encodeHelloProof(helloBytes, nonce, deviceKeyPair.public.encoded, signature)
            writeLengthDelimited(output, helloProof)
            output.flush()

            val envelopeBytes = readLengthDelimited(input, MAX_ENVELOPE_BYTES) ?: return
            val phase = runCatching {
                processOneUseEnvelope(scope, helloBytes, nonce, deviceKeyPair, helloProof, envelopeBytes, identity)
            }.fold(
                onSuccess = { it },
                onFailure = { error ->
                    if (error is ActionOutcomeUnknownException) MediaCredentialInputPhase.BLOCKED_REQUIRES_HUMAN_CLEAR
                    else MediaCredentialInputPhase.INPUT_REJECTED
                },
            )
            val statusFrame = sendSignedStatus(
                output = output,
                scope = scope,
                helloBytes = helloBytes,
                nonce = nonce,
                sequence = 1L,
                phase = phase,
                signer = signer,
            )
            authorizationClient.recordStatus(
                installationToken = requireNotNull(identity.activeSessionToken()),
                requestId = scope.requestId.toString(),
                actionId = scope.actionId.toString(),
                rawSignedStatusFrame = statusFrame,
                expectedPhase = phase.wireValue,
            )
            if (phase == MediaCredentialInputPhase.INPUT_APPLIED_QUARANTINED &&
                scope.field == MediaCredentialField.PASSWORD
            ) {
                val store = getSharedPreferences(RECEIPT_STORE, MODE_PRIVATE)
                check(store.edit().putString("status_${scope.actionId}", encodeLocal(statusFrame)).commit())
            }
            statusFrame.fill(0)
            // V1 deliberately has no CLEAR: the executor keeps every observer
            // quarantined even after a valid one-use field action.
            nonce.fill(0)
            helloBytes.fill(0)
            envelopeBytes.fill(0)
            helloProof.fill(0)
        } catch (_: Exception) {
            // A dropped/unknown response is non-retryable for this session.
        }
    }

    private fun processOneUseEnvelope(
        expectedScope: MediaCredentialInputScope,
        helloBytes: ByteArray,
        nonce: ByteArray,
        deviceKeyPair: KeyPair,
        helloProof: ByteArray,
        envelopeBytes: ByteArray,
        initialIdentity: StoredInstallationIdentity,
    ): MediaCredentialInputPhase {
        require(!stopped.get() && ParticipationService.hasCurrentConfirmation())
        val envelope = SealedMediaCredential.decode(envelopeBytes)
        val claims = envelope.claims()
        val grantReceivedElapsed = SystemClock.elapsedRealtime()
        require(validateGrantScope(
            claims = claims,
            expected = expectedScope,
            sessionNonce = nonce,
            publicKeySpki = deviceKeyPair.public.encoded,
            helloProof = helloProof,
            nowMillis = System.currentTimeMillis(),
        ))
        val remainingLifetime = claims.expiresAtMillis - System.currentTimeMillis()
        require(remainingLifetime in 1..MAX_GRANT_AGE_MS)
        val grantDeadlineElapsed = grantReceivedElapsed + remainingLifetime
        require(envelope.hasSecret == (expectedScope.field != MediaCredentialField.SUBMIT_LOGIN))
        val identityStore = InstallationIdentityStore(this)
        val token = requireNotNull(initialIdentity.activeSessionToken())
        require(currentIdentityMatches(identityStore, initialIdentity, token, claims))
        val keys = MediaCredentialInputAuthorizationClient(BuildConfig.API_BASE_URL)
            .loadServerKeys(token, System.currentTimeMillis())
        val serverKey = requireNotNull(keys[envelope.keyId])
        require(envelope.verifySignature(serverKey))

        // A backend-backed verified password receipt is required for submit.
        // This build keeps submit blocked until the backend receipt store exists.
        if (expectedScope.field == MediaCredentialField.SUBMIT_LOGIN) {
            require(verifyPriorPasswordReceipt(claims, expectedScope))
        }

        // First check is side-effect-free. The authoritative online consume
        // reloads task/assignment/credential/holder/control/lease immediately
        // before the second, same-main-looper check and effect.
        val targetFingerprint = runOnMain {
            if (expectedScope.field == MediaCredentialField.SUBMIT_LOGIN) {
                require(currentTargetMatches(expectedScope, null))
                null
            } else {
                requireNotNull(captureCredentialTarget(expectedScope))
            }
        }
        val digest = Base64.encodeToString(
            envelope.envelopeDigest(),
            Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
        )
        val consumed = MediaCredentialInputAuthorizationClient(BuildConfig.API_BASE_URL)
            .consumeOnce(token, expectedScope.actionId.toString(), digest)
        require(consumed && SystemClock.elapsedRealtime() < grantDeadlineElapsed)

        val journal = getSharedPreferences(ACTION_JOURNAL, MODE_PRIVATE)
        var effectAttempted = false
        try {
            val result = runOnMain {
                ParticipationService.withCurrentActionFence(
                    deviceId = claims.scope.deviceId,
                    installationId = claims.scope.installationId,
                    installationGeneration = claims.scope.installationGeneration,
                    controlGeneration = claims.scope.controlGeneration,
                ) {
                    require(!stopped.get())
                    require(currentIdentityMatches(identityStore, initialIdentity, token, claims))
                    requireGrantStillLive(claims, grantDeadlineElapsed)
                    if (expectedScope.field == MediaCredentialField.SUBMIT_LOGIN) {
                        require(currentTargetMatches(expectedScope, null))
                    } else {
                        require(currentCredentialTarget(expectedScope) == targetFingerprint)
                    }
                    reserveAction(journal, expectedScope.actionId)
                    when (expectedScope.field) {
                        MediaCredentialField.LOGIN, MediaCredentialField.PASSWORD -> {
                            val secret = decryptCredentialField(envelope, deviceKeyPair.private)
                            try {
                                require(applyCredentialText(expectedScope, secret, targetFingerprint) {
                                    require(!stopped.get())
                                    requireGrantStillLive(claims, grantDeadlineElapsed)
                                    require(currentIdentityMatches(identityStore, initialIdentity, token, claims))
                                    effectAttempted = true
                                })
                                if (expectedScope.field == MediaCredentialField.PASSWORD) {
                                    savePasswordReceipt(scope = expectedScope, helloBytes = helloBytes)
                                }
                                MediaCredentialInputPhase.INPUT_APPLIED_QUARANTINED
                            } finally {
                                secret.fill('\u0000')
                            }
                        }
                        MediaCredentialField.SUBMIT_LOGIN -> {
                            require(clickExactLoginButton(expectedScope) {
                                require(!stopped.get())
                                requireGrantStillLive(claims, grantDeadlineElapsed)
                                require(currentIdentityMatches(identityStore, initialIdentity, token, claims))
                                effectAttempted = true
                            })
                            MediaCredentialInputPhase.SUBMIT_APPLIED_QUARANTINED
                        }
                    }
                } ?: throw IllegalStateException("participation fence expired")
            }
            return result
        } catch (error: Exception) {
            if (effectAttempted) throw ActionOutcomeUnknownException(error)
            throw error
        }
    }

    private fun currentIdentityMatches(
        store: InstallationIdentityStore,
        original: StoredInstallationIdentity,
        token: String,
        claims: MediaCredentialGrantClaims,
    ): Boolean = runCatching {
        val current = requireNotNull(store.load())
        current.installationId == original.installationId &&
            current.generation == original.generation &&
            current.installationId == claims.scope.installationId.toString() &&
            current.generation == claims.scope.installationGeneration &&
            current.activeSessionToken() == token &&
            ParticipationService.matchesActionFence(
                deviceId = claims.scope.deviceId,
                installationId = claims.scope.installationId,
                installationGeneration = claims.scope.installationGeneration,
                controlGeneration = claims.scope.controlGeneration,
            ) &&
            claims.scope.leaseUntilMillis > System.currentTimeMillis() &&
            claims.scope.holderGrantValidUntilMillis > System.currentTimeMillis()
    }.getOrDefault(false)

    private fun requireGrantStillLive(claims: MediaCredentialGrantClaims, elapsedDeadline: Long) {
        require(claims.expiresAtMillis > System.currentTimeMillis())
        require(claims.scope.leaseUntilMillis > System.currentTimeMillis())
        require(claims.scope.holderGrantValidUntilMillis > System.currentTimeMillis())
        require(SystemClock.elapsedRealtime() < elapsedDeadline)
    }

    private data class CredentialTargetFingerprint(
        val windowId: Int,
        val viewIdResourceName: String,
        val className: String,
        val inputType: Int,
        val field: MediaCredentialField,
    )

    private fun currentTargetMatches(
        scope: MediaCredentialInputScope,
        expectedCredentialTarget: CredentialTargetFingerprint?,
    ): Boolean {
        val root = rootInActiveWindow ?: return false
        try {
            if (root.packageName?.toString() != scope.targetPackage || !root.isVisibleToUser) return false
            return when (scope.field) {
                MediaCredentialField.LOGIN, MediaCredentialField.PASSWORD ->
                    expectedCredentialTarget != null && captureCredentialTarget(root, scope) == expectedCredentialTarget
                MediaCredentialField.SUBMIT_LOGIN -> exactLoginButton(root, scope)?.let { button ->
                    try { true } finally { button.recycle() }
                } ?: false
            }
        } finally {
            root.recycle()
        }
    }

    private fun captureCredentialTarget(scope: MediaCredentialInputScope): CredentialTargetFingerprint? {
        val root = rootInActiveWindow ?: return null
        return try { captureCredentialTarget(root, scope) } finally { root.recycle() }
    }

    private fun captureCredentialTarget(
        root: AccessibilityNodeInfo,
        scope: MediaCredentialInputScope,
    ): CredentialTargetFingerprint? {
        if (root.packageName?.toString() != scope.targetPackage || !root.isVisibleToUser) return null
        val field = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return null
        try {
            if (field.packageName?.toString() != scope.targetPackage || !field.isVisibleToUser ||
                !field.isEnabled || !field.isEditable || !field.isFocused
            ) return null
            val viewId = field.viewIdResourceName?.takeIf(String::isNotBlank) ?: return null
            if (scope.field == MediaCredentialField.PASSWORD) {
                if (!field.isPassword || !isPasswordInputType(field.inputType)) return null
            } else {
                if (field.isPassword || isPasswordInputType(field.inputType) || !hasLoginSemanticViewId(viewId)) return null
            }
            val matches = runCatching { root.findAccessibilityNodeInfosByViewId(viewId) }.getOrNull().orEmpty()
            try {
                if (matches.size != 1) return null
                val only = matches.single()
                if (only.windowId != field.windowId || only.packageName?.toString() != scope.targetPackage ||
                    only.viewIdResourceName != viewId || !only.isVisibleToUser || !only.isEnabled ||
                    !only.isEditable || !only.isFocused || only.inputType != field.inputType
                ) return null
            } finally {
                matches.forEach(AccessibilityNodeInfo::recycle)
            }
            return CredentialTargetFingerprint(
                field.windowId,
                viewId,
                field.className?.toString() ?: return null,
                field.inputType,
                scope.field,
            )
        } finally {
            field.recycle()
        }
    }

    private fun hasLoginSemanticViewId(viewId: String): Boolean {
        val suffix = viewId.substringAfterLast(":id/").lowercase()
        return LOGIN_VIEW_ID_SEMANTICS.any { semantic ->
            Regex("(?:^|[^a-z0-9])${Regex.escape(semantic)}(?:$|[^a-z0-9])").containsMatchIn(suffix)
        }
    }

    private fun applyCredentialText(
        scope: MediaCredentialInputScope,
        secret: CharArray,
        expectedTarget: CredentialTargetFingerprint?,
        beforeEffect: () -> Unit,
    ): Boolean {
        val root = rootInActiveWindow ?: return false
        try {
            if (root.packageName?.toString() != scope.targetPackage) return false
            val field = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
            try {
                if (field.packageName?.toString() != scope.targetPackage || !field.isVisibleToUser ||
                    !field.isEnabled || !field.isEditable || !field.isFocused || expectedTarget == null
                ) return false
                val validKind = if (scope.field == MediaCredentialField.PASSWORD) {
                    field.isPassword && isPasswordInputType(field.inputType)
                } else {
                    scope.field == MediaCredentialField.LOGIN && !field.isPassword && !isPasswordInputType(field.inputType)
                }
                if (!validKind) return false
                val current = captureCredentialTarget(root, scope) ?: return false
                if (current != expectedTarget || field.windowId != expectedTarget.windowId ||
                    field.viewIdResourceName != expectedTarget.viewIdResourceName ||
                    field.className?.toString() != expectedTarget.className || field.inputType != expectedTarget.inputType
                ) return false
                // Android's accessibility API accepts CharSequence only. This
                // creates an immutable String that cannot be wiped; the char[]
                // and Bundle are cleared best-effort after the platform call.
                val chars = String(secret)
                val arguments = Bundle().apply {
                    putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, chars)
                }
                return try {
                    beforeEffect()
                    field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
                } finally {
                    arguments.clear()
                }
            } finally {
                field.recycle()
            }
        } finally {
            root.recycle()
        }
    }

    private fun clickExactLoginButton(scope: MediaCredentialInputScope, beforeEffect: () -> Unit): Boolean {
        val root = rootInActiveWindow ?: return false
        try {
            if (root.packageName?.toString() != scope.targetPackage) return false
            val button = exactLoginButton(root, scope) ?: return false
            try {
                beforeEffect()
                return button.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            } finally {
                button.recycle()
            }
        } finally {
            root.recycle()
        }
    }

    private fun exactLoginButton(root: AccessibilityNodeInfo, scope: MediaCredentialInputScope): AccessibilityNodeInfo? {
        val targetId = scope.targetViewIdResourceName ?: return null
        if (!targetId.startsWith("${scope.targetPackage}:id/")) return null
        val matches = runCatching { root.findAccessibilityNodeInfosByViewId(targetId) }.getOrNull().orEmpty()
        try {
            if (matches.size != 1) return null
            val node = matches.single()
            val klass = node.className?.toString().orEmpty()
            val labels = setOf("Log in", "Log In", "Login", "Sign in", "Sign In", "登录", "登入")
            val label = node.text?.toString()?.trim() ?: node.contentDescription?.toString()?.trim()
            if (node.packageName?.toString() != scope.targetPackage || !node.isVisibleToUser ||
                !node.isEnabled || !node.isClickable || !klass.endsWith("Button") || label !in labels
            ) return null
            return AccessibilityNodeInfo.obtain(node)
        } finally {
            matches.forEach(AccessibilityNodeInfo::recycle)
        }
    }

    private fun reserveAction(journal: android.content.SharedPreferences, actionId: UUID) {
        val key = "consumed_${actionId}"
        require(!journal.contains(key))
        require(journal.all.size < MAX_LOCAL_JOURNAL_ENTRIES)
        check(journal.edit().putBoolean(key, true).commit())
    }

    private fun savePasswordReceipt(scope: MediaCredentialInputScope, helloBytes: ByteArray) {
        val store = getSharedPreferences(RECEIPT_STORE, MODE_PRIVATE)
        check(store.edit()
            .putString("hello_${scope.actionId}", encodeLocal(helloBytes))
            .putString("scope_${scope.actionId}", encodeLocal(scope.encodeHelloRequest()))
            .commit())
    }

    private fun verifyPriorPasswordReceipt(
        claims: MediaCredentialGrantClaims,
        submitScope: MediaCredentialInputScope,
    ): Boolean = runCatching {
        val actionId = requireNotNull(claims.priorPasswordActionId)
        val expectedDigest = requireNotNull(claims.priorPasswordStatusFrameDigest)
        val expectedNonce = requireNotNull(claims.priorPasswordSessionNonce)
        val store = getSharedPreferences(RECEIPT_STORE, MODE_PRIVATE)
        val scopeBytes = decodeLocal(requireNotNull(store.getString("scope_$actionId", null)))
        val priorScope = MediaCredentialInputScope.decodeHelloRequest(scopeBytes)
        require(priorScope.field == MediaCredentialField.PASSWORD)
        require(priorScope.actionId == actionId)
        require(priorScope.taskAttemptId == submitScope.taskAttemptId)
        require(priorScope.deviceId == submitScope.deviceId && priorScope.installationId == submitScope.installationId)
        require(priorScope.installationGeneration == submitScope.installationGeneration)
        require(priorScope.holderId == submitScope.holderId && priorScope.authorizationId == submitScope.authorizationId)
        require(priorScope.controlGeneration == submitScope.controlGeneration)
        require(priorScope.accountId == submitScope.accountId && priorScope.credentialId == submitScope.credentialId)
        val helloBytes = decodeLocal(requireNotNull(store.getString("hello_$actionId", null)))
        val statusBytes = decodeLocal(requireNotNull(store.getString("status_$actionId", null)))
        require(MessageDigest.isEqual(MessageDigest.getInstance("SHA-256").digest(statusBytes), expectedDigest))
        val status = MediaCredentialInputStatus.decode(statusBytes)
        require(status.verify(EnrollmentKeySigner(submitScope.installationId).existingMediaInputPublicKey()))
        require(status.phase == MediaCredentialInputPhase.INPUT_APPLIED_QUARANTINED)
        require(status.actionId == actionId && status.requestId == actionId)
        require(status.deviceId == submitScope.deviceId && status.installationId == submitScope.installationId)
        require(status.installationGeneration == submitScope.installationGeneration)
        require(MessageDigest.isEqual(status.sessionNonce, expectedNonce))
        require(MessageDigest.isEqual(status.helloRequestDigest, MessageDigest.getInstance("SHA-256").digest(helloBytes)))
        true
    }.getOrDefault(false)

    private fun encodeLocal(bytes: ByteArray): String = Base64.encodeToString(
        bytes,
        Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING,
    )

    private fun decodeLocal(value: String): ByteArray = Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    private fun <T> runOnMain(block: () -> T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) return block()
        val latch = CountDownLatch(1)
        val state = AtomicInteger(MAIN_QUEUED)
        var result: Result<T>? = null
        check(main.post {
            if (!state.compareAndSet(MAIN_QUEUED, MAIN_RUNNING)) {
                latch.countDown()
                return@post
            }
            try {
                result = runCatching(block)
            } finally {
                state.set(MAIN_DONE)
                latch.countDown()
            }
        }) { "main-thread gate unavailable" }
        try {
            if (!latch.await(MAIN_GATE_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                if (state.compareAndSet(MAIN_QUEUED, MAIN_CANCELLED)) {
                    throw IllegalStateException("main-thread action cancelled before execution")
                }
                // Once started, do not return a rejection while a side effect
                // can still run. Wait for its final outcome; socket loss keeps
                // the host quarantined and never authorizes a retry.
                latch.await()
            }
        } catch (interrupted: InterruptedException) {
            if (state.compareAndSet(MAIN_QUEUED, MAIN_CANCELLED)) {
                Thread.currentThread().interrupt()
                throw interrupted
            }
            while (latch.count > 0) {
                try { latch.await() } catch (_: InterruptedException) { /* preserve unknown until running action ends */ }
            }
            Thread.currentThread().interrupt()
            throw interrupted
        }
        return requireNotNull(result).getOrThrow()
    }

    private fun matchesCurrentInstallation(
        scope: MediaCredentialInputScope,
        identity: StoredInstallationIdentity,
    ): Boolean = runCatching {
        scope.installationId == UUID.fromString(requireNotNull(identity.installationId)) &&
            scope.installationGeneration == requireNotNull(identity.generation) &&
            scope.serial.isNotBlank() && identity.activeSessionToken() != null &&
            ParticipationService.matchesActionFence(
                deviceId = scope.deviceId,
                installationId = scope.installationId,
                installationGeneration = scope.installationGeneration,
                controlGeneration = scope.controlGeneration,
            )
    }.getOrDefault(false)

    private fun createEphemeralDeviceKeyPair(): KeyPair = KeyPairGenerator.getInstance("RSA").run {
        initialize(RSA_KEY_BITS, SecureRandom())
        generateKeyPair()
    }.also { pair ->
        val rsa = pair.public as? java.security.interfaces.RSAPublicKey
        require(rsa != null && rsa.modulus.bitLength() == RSA_KEY_BITS && rsa.publicExponent == RSA_PUBLIC_EXPONENT)
        require(pair.public.encoded.size in MIN_RSA_SPKI_BYTES..MAX_RSA_SPKI_BYTES)
    }

    private fun encodeHelloProof(
        hello: ByteArray,
        nonce: ByteArray,
        publicKey: ByteArray,
        signature: ByteArray,
    ): ByteArray {
        require(signature.size in 8..MAX_SIGNATURE_BYTES)
        return java.io.ByteArrayOutputStream().also { bytes ->
            DataOutputStream(bytes).use { output ->
                output.write(HELLO_PROOF_MAGIC)
                output.writeByte(PROTOCOL_VERSION)
                output.writeInt(hello.size)
                output.write(hello)
                output.write(nonce)
                output.writeShort(publicKey.size)
                output.write(publicKey)
                output.writeByte(signature.size)
                output.write(signature)
            }
        }.toByteArray()
    }

    private fun sendSignedStatus(
        output: DataOutputStream,
        scope: MediaCredentialInputScope,
        helloBytes: ByteArray,
        nonce: ByteArray,
        sequence: Long,
        phase: MediaCredentialInputPhase,
        signer: EnrollmentKeySigner,
    ): ByteArray {
        val prefix = mediaCredentialInputStatusPrefix(
            deviceId = scope.deviceId,
            installationId = scope.installationId,
            installationGeneration = scope.installationGeneration,
            sessionNonce = nonce,
            requestId = scope.requestId,
            actionId = scope.actionId,
            helloRequestDigest = java.security.MessageDigest.getInstance("SHA-256").digest(helloBytes),
            sequence = sequence,
            phase = phase,
        )
        val signature = signer.signExistingMediaInputProof(mediaCredentialInputStatusSignatureInput(prefix))
        require(signature.size in 8..MAX_SIGNATURE_BYTES)
        val frame = prefix + byteArrayOf(signature.size.toByte()) + signature
        writeLengthDelimited(output, frame)
        output.flush()
        signature.fill(0)
        return frame
    }

    private fun readLengthDelimited(input: DataInputStream, limit: Int): ByteArray? {
        val size = try { input.readInt() } catch (_: IOException) { return null }
        require(size in 1..limit)
        return ByteArray(size).also(input::readFully)
    }

    private fun writeLengthDelimited(output: DataOutputStream, value: ByteArray) {
        require(value.size in 1..MAX_ENVELOPE_BYTES)
        output.writeInt(value.size)
        output.write(value)
    }

    companion object {
        /** Local abstract socket is transport only; never treated as authorization. */
        const val LOCAL_SOCKET_NAME = "socialgrowth_media_input_v1"
        private const val SOCKET_TIMEOUT_MS = 30_000
        private const val MAX_GRANT_AGE_MS = 30_000L
        private const val RSA_KEY_BITS = 2048
        private val RSA_PUBLIC_EXPONENT = java.math.BigInteger.valueOf(65537)
        private const val MIN_RSA_SPKI_BYTES = 256
        private const val MAX_RSA_SPKI_BYTES = 1024
        private const val MAX_HELLO_BYTES = 1024
        private const val MAX_ENVELOPE_BYTES = 8192
        private const val MAX_SIGNATURE_BYTES = 72
        private const val MAX_LOCAL_JOURNAL_ENTRIES = 8192
        private const val MAIN_GATE_TIMEOUT_MS = 5_000L
        private const val MAIN_QUEUED = 0
        private const val MAIN_RUNNING = 1
        private const val MAIN_CANCELLED = 2
        private const val MAIN_DONE = 3
        private const val NONCE_BYTES = 32
        private const val PROTOCOL_VERSION = 1
        private const val ACTION_JOURNAL = "media_credential_input_action_journal"
        private const val RECEIPT_STORE = "media_credential_input_receipts"
        private const val FACEBOOK_PACKAGE = "com.facebook.katana"
        private const val YOUTUBE_PACKAGE = "com.google.android.youtube"
        private val LOGIN_VIEW_ID_SEMANTICS = setOf("username", "user_name", "userid", "user_id", "email", "account", "identifier", "phone", "login")
        private val HELLO_PROOF_MAGIC = byteArrayOf('S'.code.toByte(), 'G'.code.toByte(), 'H'.code.toByte(), 'P'.code.toByte())
    }

    private class ActionOutcomeUnknownException(cause: Throwable) : IllegalStateException("input effect outcome unknown", cause)
}
