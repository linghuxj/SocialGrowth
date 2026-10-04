package com.socialgrowth.product

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Explicitly started by the visible installed client. Never sticky or boot-started. */
class ParticipationService : Service() {
    companion object {
        const val START="com.socialgrowth.product.PARTICIPATE"
        const val STOP="com.socialgrowth.product.WITHDRAW"
        private const val CHANNEL="device-participation"
        @Volatile private var confirmedUntil=0L
        @Volatile private var currentParticipationScope: ParticipationScope? = null
        @Volatile private var phase="尚未确认参与"
        fun statusText(): String = if(running && SystemClock.elapsedRealtime()<confirmedUntil)
            "本机参与已确认；执行条件仍需系统核验。" else phase
        /** A current pulse is a local precondition, never action authorization. */
        fun hasCurrentConfirmation(): Boolean = running && SystemClock.elapsedRealtime() < confirmedUntil
        fun matchesActionFence(deviceId: UUID, installationId: UUID, installationGeneration: Long, controlGeneration: Long): Boolean {
            val scope = currentParticipationScope ?: return false
            return hasCurrentConfirmation() && scope.deviceId == deviceId.toString() &&
                scope.installationId == installationId.toString() &&
                scope.installationGeneration.toLongOrNull() == installationGeneration &&
                scope.controlGeneration?.toLongOrNull() == controlGeneration
        }
        @Volatile var running=false
            private set
    }
    private val live=AtomicBoolean(false)
    private val worker=Executors.newSingleThreadExecutor()
    private val main=Handler(Looper.getMainLooper())
    private var lastStartId=0
    private var workerActive=false // Main-thread owned; blocks restart until withdrawal finishes.
    // Debug diagnostics contain only bounded phase/timing facts. No run/session
    // token, device identity, challenge, HTTP body or exception message.
    private fun diagnostic(event: String, phase: String, elapsedMs: Long = 0) {
        if(BuildConfig.DEBUG) Log.i("SGParticipation", "event=$event phase=$phase elapsedMs=$elapsedMs")
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?,flags: Int,startId: Int): Int {
        lastStartId=startId
        if(intent?.action==STOP) {
            diagnostic("withdraw_requested", "visible_client")
            live.set(false); running=false;confirmedUntil=0L;currentParticipationScope=null;phase="已停止后续参与确认；中心撤权和手机停止仍待核实。"
            if(!workerActive) stopSelf()
            return START_NOT_STICKY
        }
        if(intent?.action!=START) { stopSelf(); return START_NOT_STICKY }
        if(workerActive) return START_NOT_STICKY
        workerActive=true
        live.set(true)
        confirmedUntil=0L;currentParticipationScope=null;phase="正在连接中心确认本机参与。"
        val manager=getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL,"本机参与状态",NotificationManager.IMPORTANCE_LOW))
        val open=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification=Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("SocialGrowth 本机状态").setContentText("当前使用状态无法确认；操作前请打开 App 查看并暂停。")
            .setContentIntent(open).setOngoing(true).build()
        try {
            if(Build.VERSION.SDK_INT>=29) startForeground(2401,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
            else startForeground(2401,notification)
        } catch (_: Exception) { live.set(false);running=false;confirmedUntil=0L;phase="本机参与服务未能启动，请检查客户端系统设置。";workerActive=false;stopSelfResult(lastStartId);return START_NOT_STICKY }
        running=true
        worker.execute { loop() }
        return START_NOT_STICKY
    }
    private fun loop() {
        val runId=UUID.randomUUID().toString()
        val store=InstallationIdentityStore(this)
        val identity=store.load()
        val token=identity?.activeSessionToken()
        val api=ParticipationApiClient(ProviderApiClient(BuildConfig.API_BASE_URL))
        var stage="start"
        var roundStarted=SystemClock.elapsedRealtime()
        var ending="session_unavailable"
        val freshness=ParticipationFreshness()
        try {
            if(token==null || !live.get()) return
            val run=api.start(token,runId)
            require(run.runId==runId && run.scope.installationId==requireNotNull(identity).installationId && run.scope.installationGeneration==identity.generation.toString())
            currentParticipationScope=run.scope
            ending="withdraw_requested"
            while(live.get()) {
                if(!freshness.canContinue(SystemClock.elapsedRealtime())) { ending="participation_expired";break }
                stage="identity"
                require(store.load()?.activeSessionToken()==token)
                val before=SystemClock.elapsedRealtime()
                roundStarted=before
                stage="challenge"
                val challenge=api.challenge(token,runId)
                // A scope/epoch change requires another visible local decision,
                // never an automatic restoration after pause/replacement.
                require(challenge.runId==runId && challenge.scope==run.scope)
                if(!live.get()) break
                if(!freshness.canContinue(SystemClock.elapsedRealtime())) { ending="participation_expired";break }
                if(SystemClock.elapsedRealtime()-before>=6_000L) { ending="challenge_deadline";break }
                stage="confirm"
                api.confirm(token,challenge)
                if(!live.get()) break
                if(!freshness.canContinue(SystemClock.elapsedRealtime())) { ending="participation_expired";break }
                if(SystemClock.elapsedRealtime()-before>=10_000L) { ending="confirm_deadline";break }
                freshness.confirmed(before)
                confirmedUntil=before+10_000L
                phase="当前确认已过期；等待下一次中心确认。"
                diagnostic("pulse_confirmed", stage, SystemClock.elapsedRealtime()-before)
                stage="wait"
                // Network latency is part of the four-second cadence, not an
                // additional delay after confirmation. Never extend freshness.
                val nextRound=SystemClock.elapsedRealtime()+freshness.nextRoundDelay(before,SystemClock.elapsedRealtime())
                while(live.get() && SystemClock.elapsedRealtime()<nextRound) { Thread.sleep(100) }
            }
        } catch (_: Exception) {
            ending="request_or_scope_rejected"
            diagnostic("loop_rejected", stage, SystemClock.elapsedRealtime()-roundStarted)
        }
        finally {
            diagnostic("loop_ended", ending)
            live.set(false); running=false;confirmedUntil=0L;currentParticipationScope=null;phase="本机参与确认已结束；中心撤权和手机停止仍待核实。"
            if(token!=null) { try { api.withdraw(token,runId) } catch (_: Exception) { /* Pulse expires; stop is still unconfirmed. */ } }
            main.post {
                workerActive=false
                stopForeground(STOP_FOREGROUND_REMOVE);stopSelfResult(lastStartId)
            }
        }
    }
    override fun onDestroy() { live.set(false);running=false;confirmedUntil=0L;currentParticipationScope=null;worker.shutdown();super.onDestroy() }
}
