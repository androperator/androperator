package androperator.di

import action.coroutine.CoroutineContextProvider
import action.coroutine.CoroutineScopes
import action.device.DeviceModel
import action.device.createSystemDeviceModel
import action.di.Lazy
import action.graphics.color.ColorManager
import action.settings.AllSettings
import action.system.window.WindowFrameManager
import action.system.window.WindowFrameManagerDefault
import action.system.window.WindowFrameManagerNoOp
import androperator.appstate.AppState
import androperator.appstate.AppStateMainProcess
import androperator.network.HttpClientFactory
import androperator.prefs.DevicePreferenceStorage
import androperator.prefs.DevicePreferenceStorageDefault
import androperator.prefs.PreferenceStorage
import androperator.prefs.PreferenceStorageDefault
import io.ktor.client.HttpClient
import kotlinx.coroutines.CoroutineScope
import org.koin.core.scope.Scope


abstract class FactoryCommon : FactoryBase {

    override var runningTest: Boolean = false
    override var multiProcessAllowed: Boolean? = null
    val liveWallpaperAllowed: Boolean
        get() = multiProcessAllowed == true

    // Used during the dagger to koin migration in cases where we need to override the default
    // behavior to keep running, but we want to keep a record of each of these cases.
    var useCompatibility: Boolean = true

    fun adMobTestDeviceIds(scope: Scope): List<String> = emptyList()

    fun colorManager(): ColorManager = ColorManager()

    fun deviceModel(): DeviceModel = createSystemDeviceModel()

    override fun devicePreferenceStorage(scope: Scope): DevicePreferenceStorage {
        return DevicePreferenceStorageDefault(
            scope.get(),
            scope.get(NamedScope.DeviceSettings),
            scope.get(NamedScope.CoroutineScopeMain),
        )
    }

    fun httpClient(scope: Scope): HttpClient {
        return HttpClientFactory.createHttpClient()
    }

    override fun preferenceStorage(scope: Scope): PreferenceStorage {
        return PreferenceStorageDefault(
            scope.get(),
            scope.get(NamedScope.UserSettings),
            scope.get(NamedScope.CoroutineScopeMain),
        )
    }

    override fun coroutineScopeIo(scope: Scope): CoroutineScope {
        return CoroutineScope(scope.get<CoroutineContextProvider>().io)
    }

    override fun coroutineScopeMain(scope: Scope): CoroutineScope {
        return CoroutineScope(scope.get<CoroutineContextProvider>().main)
    }

    override fun coroutineScopes(scope: Scope): CoroutineScopes {
        return CoroutineScopes(
            main = scope.get(NamedScope.CoroutineScopeMain),
            io = scope.get(NamedScope.CoroutineScopeIo),
        )
    }

    fun appState(scope: Scope): AppState {
        val lazyAppState: Lazy<AppStateMainProcess> = scope.get(NamedScope.LazyAppStateMainProcess)
        return lazyAppState.get()
    }

    fun allSettings(scope: Scope) = AllSettings(
        listOf(
            scope.get(NamedScope.DeviceSettings),
            scope.get(NamedScope.UserSettings),
        )
    )

    override fun windowFrameManager(scope: Scope): WindowFrameManager {
        return if (runningTest) {
            WindowFrameManagerNoOp
        } else {
            WindowFrameManagerDefault(scope.get())
        }
    }

}
