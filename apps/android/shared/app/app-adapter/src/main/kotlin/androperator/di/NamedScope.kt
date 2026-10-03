package androperator.di

import org.koin.core.qualifier.named

object NamedScope {
    val ApplicationId = named("ApplicationId")
    val CoroutineScopeIo = named("CoroutineScopeIo")
    val CoroutineScopeMain = named("CoroutineScopeMain")
    val DeviceSettings = named("DeviceSettings")
    val DeviceSharedPrefs = named("DeviceSharedPrefs")
    val LazyAppState = named("LazyAppState")
    val LazyAppStateMainProcess = named("LazyAppStateMainProcess")
    val LazyAppViewModel = named("LazyAppViewModel")
    val LazyAppVisibilityDefaultProcess = named("LazyAppVisibilityDefaultProcess")
    val LazyDevicePreferenceStorage = named("LazyDevicePreferenceStorage")
    val LazyDeviceStateSystem = named("LazyDeviceStateSystem")
    val LazyPreferenceStorage = named("LazyPreferenceStorage")
    val LazySystemActionManager = named("LazySystemActionManager")
    val LazyTimeRepository = named("LazyTimeRepository")
    val LazyTriggerManager = named("LazyTriggerManager")
    val UserSettings = named("UserSettings")
    val UserSharedPrefs = named("UserSharedPrefs")
}
