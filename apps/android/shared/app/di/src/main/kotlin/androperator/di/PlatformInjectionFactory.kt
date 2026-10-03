package androperator.di

import action.context.getLauncherAppsService
import action.context.getUserManager
import android.app.UiModeManager
import android.app.job.JobScheduler
import android.content.Context
import android.content.pm.LauncherApps
import android.content.pm.PackageManager
import android.content.res.AssetManager
import android.hardware.SensorManager
import android.net.ConnectivityManager
import android.os.Handler
import android.os.Looper
import android.os.UserManager
import android.view.WindowManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object PlatformInjectionFactory {

    fun assetManager(context: Context): AssetManager = context.assets

    fun connectivityManager(context: Context): ConnectivityManager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    fun jobsSchedulerService(context: Context) : JobScheduler =
        context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler

    fun launcherApps(context: Context): LauncherApps = context.getLauncherAppsService()

    fun notificationManagerCompat(context: Context): NotificationManagerCompat =
        NotificationManagerCompat.from(context)

    fun packageManager(context: Context): PackageManager = context.packageManager

    fun sensorManager(context: Context): SensorManager {
        return requireNotNull(
            ContextCompat.getSystemService(
                context,
                SensorManager::class.java,
            )
        )
    }

    fun uiModeManager(context: Context): UiModeManager =
        context.getSystemService(Context.UI_MODE_SERVICE) as UiModeManager

    fun userManager(context: Context): UserManager = context.getUserManager()

    fun windowManager(context: Context): WindowManager {
        return requireNotNull(
            ContextCompat.getSystemService(
                context,
                WindowManager::class.java,
            )
        )
    }

    fun provideMainThreadHandler(): Handler =
        Handler(Looper.getMainLooper())

}