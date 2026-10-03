package androperator.di

import action.appvisibility.AppVisibility
import action.coroutine.CoroutineContextProvider
import action.coroutine.CoroutineScopes
import action.devicerefreshrate.DeviceRefreshRate
import action.devicestate.DeviceState
import action.network.NetworkState
import action.settings.Settings
import action.system.window.WindowFrameManager
import androperator.prefs.DevicePreferenceStorage
import androperator.prefs.PreferenceStorage
import kotlinx.coroutines.CoroutineScope
import org.koin.core.scope.Scope

interface FactoryBase {

    var runningTest: Boolean
    var multiProcessAllowed: Boolean?

    fun appVisibility(scope: Scope): AppVisibility
    fun coroutineContextProvider(scope: Scope): CoroutineContextProvider
    fun coroutineScopeIo(scope: Scope): CoroutineScope
    fun coroutineScopeMain(scope: Scope): CoroutineScope
    fun coroutineScopes(scope: Scope): CoroutineScopes
    fun devicePreferenceStorage(scope: Scope): DevicePreferenceStorage
    fun deviceRefreshRate(scope: Scope) : DeviceRefreshRate
    fun deviceSettings(scope: Scope): Settings
    fun deviceState(scope: Scope): DeviceState
    fun networkState(scope: Scope): NetworkState
    fun preferenceStorage(scope: Scope): PreferenceStorage
    fun userSettings(scope: Scope): Settings
    fun windowFrameManager(scope: Scope): WindowFrameManager
}
