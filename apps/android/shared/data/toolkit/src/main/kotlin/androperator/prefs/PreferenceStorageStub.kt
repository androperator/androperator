package androperator.prefs

import action.coroutine.CoroutineScopeDefault
import action.settings.Settings
import action.settings.SettingsMemory
import kotlinx.coroutines.CoroutineScope

class PreferenceStorageStub(
    settings: Settings = SettingsMemory("PreferenceStorageStub/settings"),
    coroutineScope: CoroutineScope = CoroutineScopeDefault,
) : PreferenceStorageDefault(
        PreferenceDefaults(PreferenceDefaultsProviderMock()),
        settings,
        coroutineScope,
    )
