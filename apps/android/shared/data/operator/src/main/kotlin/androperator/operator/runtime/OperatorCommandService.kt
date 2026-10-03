package androperator.operator.runtime

import action.crashtracking.LocalCrashLog
import action.log.Log
import android.app.ForegroundServiceStartNotAllowedException
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androperator.operator.runtime.OperatorCommandReceiver.Companion.ACTION_AGENT_COMMAND

class OperatorCommandService : Service() {
    companion object {
        private const val NOTIFICATION_CHANNEL_ID = "operator_service_channel"
        private const val NOTIFICATION_ID = 1
    }

    private val commandReceiver = OperatorCommandReceiver()

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()

        // Register the debug broadcast receiver
        val filter =
            IntentFilter().apply {
                addAction(ACTION_AGENT_COMMAND)
            }
        ContextCompat.registerReceiver(
            this,
            commandReceiver,
            filter,
            ContextCompat.RECEIVER_EXPORTED,
        )
        Log.d("[Operator-CommandService] Command receiver registered")
    }

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        val notification = createNotification()
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            // Detach from foreground immediately; keep the notification but avoid long-running FGS timeouts.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_DETACH)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(false)
            }
            stopSelf()
            START_NOT_STICKY
        } catch (e: ForegroundServiceStartNotAllowedException) {
            Log.e(e, "[Operator-CommandService] startForeground not allowed")
            LocalCrashLog.logWarning("[Operator-CommandService] startForeground not allowed", e)
            stopSelf()
            START_NOT_STICKY
        } catch (e: Exception) {
            Log.e(e, "[Operator-CommandService] startForeground failed")
            LocalCrashLog.logWarning("[Operator-CommandService] startForeground failed", e)
            stopSelf()
            START_NOT_STICKY
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        try {
            unregisterReceiver(commandReceiver)
            Log.d("[Operator-CommandService] Command receiver unregistered")
        } catch (e: Exception) {
            Log.e("[Operator-CommandService] Error unregistering receiver: ${e.message}")
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createNotificationChannel() {
        val channel =
            NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "[Androperator] Operator",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply {
                description = "Keeps the operator service running"
            }

        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.createNotificationChannel(channel)
    }

    private fun createNotification(): Notification {
        return NotificationCompat
            .Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("[Androperator] Operator Service")
            .setContentText("Listening for agent command broadcasts")
            .setSmallIcon(androperator.resources.R.drawable.ic_notification)
            .build()
    }
}
