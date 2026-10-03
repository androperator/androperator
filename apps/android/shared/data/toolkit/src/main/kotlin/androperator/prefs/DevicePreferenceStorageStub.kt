package androperator.prefs

import action.coroutine.CoroutineScopeDefault
import action.settings.Settings
import action.settings.SettingsMemory
import kotlinx.coroutines.CoroutineScope

class DevicePreferenceStorageStub(
    settings: Settings = SettingsMemory("DevicePreferenceStorageStub/settings"),
    coroutineScope: CoroutineScope = CoroutineScopeDefault,
) : DevicePreferenceStorageDefault(
        PreferenceDefaults(PreferenceDefaultsProviderMock()),
        settings,
        coroutineScope,
    )
