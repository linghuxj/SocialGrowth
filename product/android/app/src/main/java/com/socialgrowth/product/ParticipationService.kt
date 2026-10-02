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
        @Volatile private var phase="尚未确认参与"
        fun statusText(): String = if(running && SystemClock.elapsedRealtime()<confirmedUntil)
            "本机参与已确认；执行条件仍需系统核验。" else phase
        @Volatile var running=false
            private set
    }
    private val live=AtomicBoolean(false)
    private val worker=Executors.newSingleThreadExecutor()
    private val main=Handler(Looper.getMainLooper())
    private var lastStartId=0
    private var workerActive=false // Main-thread owned; blocks restart until withdrawal finishes.
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?,flags: Int,startId: Int): Int {
        lastStartId=startId
        if(intent?.action==STOP) {
            live.set(false); running=false;confirmedUntil=0L;phase="已停止后续参与确认；中心撤权和手机停止仍待核实。"
            if(!workerActive) stopSelf()
            return START_NOT_STICKY
        }
        if(intent?.action!=START) { stopSelf(); return START_NOT_STICKY }
        if(workerActive) return START_NOT_STICKY
        workerActive=true
        live.set(true)
        confirmedUntil=0L;phase="正在连接中心确认本机参与。"
        val manager=getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL,"本机参与状态",NotificationManager.IMPORTANCE_LOW))
        val stop=PendingIntent.getService(this,0,Intent(this,ParticipationService::class.java).setAction(STOP),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification=Notification.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("SocialGrowth 本机参与确认").setContentText("保持与中心连接；尚不代表可执行任务。")
            .setOngoing(true).addAction(Notification.Action.Builder(null,"撤回参与",stop).build()).build()
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
        try {
            if(token==null || !live.get()) return
            val run=api.start(token,runId)
            require(run.runId==runId && run.scope.installationId==requireNotNull(identity).installationId && run.scope.installationGeneration==identity.generation.toString())
            while(live.get()) {
                require(store.load()?.activeSessionToken()==token)
                val before=SystemClock.elapsedRealtime()
                val challenge=api.challenge(token,runId)
                // A scope/epoch change requires another visible local decision,
                // never an automatic restoration after pause/replacement.
                require(challenge.runId==runId && challenge.scope==run.scope)
                if(!live.get() || SystemClock.elapsedRealtime()-before>=6_000L) break
                api.confirm(token,challenge)
                if(!live.get() || SystemClock.elapsedRealtime()-before>=10_000L) break
                confirmedUntil=before+10_000L
                phase="当前确认已过期；等待下一次中心确认。"
                var wait=0
                while(live.get() && wait<40) { Thread.sleep(100);wait++ }
            }
        } catch (_: Exception) { /* No raw messages, tokens or request bodies in logs. */ }
        finally {
            live.set(false); running=false;confirmedUntil=0L;phase="本机参与确认已结束；中心撤权和手机停止仍待核实。"
            if(token!=null) { try { api.withdraw(token,runId) } catch (_: Exception) { /* Pulse expires; stop is still unconfirmed. */ } }
            main.post {
                workerActive=false
                stopForeground(STOP_FOREGROUND_REMOVE);stopSelfResult(lastStartId)
            }
        }
    }
    override fun onDestroy() { live.set(false);running=false;worker.shutdown();super.onDestroy() }
}
