package androperator.di

import action.appvisibility.AppVisibility
import action.buildconfig.BuildConfig
import action.buildconfig.BuildConfigDefault
import action.coroutine.CoroutineContextProvider
import action.coroutine.CoroutineContextProviderAndroid
import action.coroutine.CoroutineContextProviderJvm
import action.devicerefreshrate.DeviceRefreshRate
import action.devicerefreshrate.DeviceRefreshRateSystem
import action.devicerefreshrate.DeviceRefreshRateSystemVariable
import action.devicestate.DeviceState
import action.devicestate.DeviceStateSystem
import action.di.Lazy
import action.network.NetworkState
import action.network.NetworkStateDefault
import action.preferences.SharedPreferencesUpgrader
import action.settings.Settings
import action.settings.SettingsMemory
import action.settings.SettingsSharedPreferences
import action.system.window.WindowFrameManager
import action.system.window.WindowFrameManagerAndroid
import action.system.window.WindowFrameManagerNoOp
import android.app.Application
import android.content.Context
import android.os.Build
import android.content.SharedPreferences
import android.net.ConnectivityManager
import androperator.preferences.PreferenceDefinitions
import kotlinx.coroutines.CoroutineScope
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import org.koin.core.scope.Scope
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.ExecutorService

object FactoryAndroid : FactoryCommon() {

    var useMemorySettings = false

    override fun appVisibility(scope: Scope): AppVisibility {
        val default: Lazy<action.appvisibility.AppVisibilityDefaultProcess> = scope.get(NamedScope.LazyAppVisibilityDefaultProcess)
        return default.get()
    }

    override fun coroutineContextProvider(scope: Scope): CoroutineContextProvider {
        return if (runningTest) {
            CoroutineContextProviderJvm
        } else {
            CoroutineContextProviderAndroid
        }
    }

    override fun deviceSettings(scope: Scope): Settings {
        if (useMemorySettings) {
            return SettingsMemory()
        }

        val sharedPreferences = scope.get<SharedPreferences>(NamedScope.DeviceSharedPrefs)
        return SettingsSharedPreferences(sharedPreferences)
    }

    override fun deviceState(scope: Scope): DeviceState {
        val deviceStateSystem: Lazy<DeviceStateSystem> = scope.get(NamedScope.LazyDeviceStateSystem)
        return deviceStateSystem.get()
    }

    fun createBuildConfig(context: Context, debug: Boolean) =
        BuildConfigDefault(context, debug)

//    override fun systemWallpaperManager(scope: Scope): SystemWallpaperManager = scope.get<SystemWallpaperManagerDefault>()

    fun getRelevantContext(scope: Scope): Context =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            scope.get<Context>().createDeviceProtectedStorageContext()
        } else {
            scope.get<Context>()
        }

    fun userSharedPrefs(scope: Scope) : SharedPreferences {
        return getRelevantContext(scope)
            .getSharedPreferences(PreferenceDefinitions.UserSettingsFilename, Application.MODE_PRIVATE).also {
                scope.get<SharedPreferencesUpgrader>().update(it)
            }
    }

    fun deviceSharedPrefs(scope: Scope): SharedPreferences {
        return getRelevantContext(scope).getSharedPreferences(
            PreferenceDefinitions.DeviceSettingsFilename,
            Context.MODE_PRIVATE
        ).
        also {
            scope.get<SharedPreferencesUpgrader>().update(it)
        }
    }


    fun applicationId(scope: Scope): String {
        val context: Context = scope.get()
        return context.packageName
    }

    fun executor(): Executor = executorService()

    fun executorService(): ExecutorService = Executors.newSingleThreadExecutor()

    override fun deviceRefreshRate(scope: Scope) : DeviceRefreshRate {
        val systemRefreshRate: DeviceRefreshRateSystem = scope.get()
        val appVisibility: AppVisibility = scope.get()
        val coroutineScope: CoroutineScope = scope.get(NamedScope.CoroutineScopeMain)
        return if (systemRefreshRate.deviceSupportedRefreshRates.size > 1) {
            DeviceRefreshRateSystemVariable(systemRefreshRate, appVisibility, coroutineScope)
        } else {
            systemRefreshRate
        }
    }

    override fun networkState(scope: Scope) : NetworkState {
        val connectivityManager: ConnectivityManager = scope.get()
        return NetworkStateDefault(connectivityManager)
    }

    fun createOkHttpClient(scope: Scope): OkHttpClient {
        val buildConfig: BuildConfig = scope.get()
        return OkHttpClient.Builder()
            .apply {
                if (buildConfig.debug) {
//                addInterceptor(DelayInterceptor(2000L))
                    addInterceptor((HttpLoggingInterceptor())
                        .apply { level = HttpLoggingInterceptor.Level.BASIC })
                }
            }.build()
    }

    override fun userSettings(scope: Scope): Settings {
        if (useMemorySettings) {
            return SettingsMemory()
        }

        val sharedPreferences = scope.get<SharedPreferences>(NamedScope.UserSharedPrefs)
        return SettingsSharedPreferences(sharedPreferences)
    }

    override fun windowFrameManager(scope: Scope): WindowFrameManager {
        return if (runningTest) {
            WindowFrameManagerNoOp
        } else {
            scope.get<WindowFrameManagerAndroid>()
        }
    }
}
