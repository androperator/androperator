@file:Suppress("MemberVisibilityCanBePrivate")

package androperator.prefs

import action.preference.MutableObservableValue
import action.preference.PreferenceInfo
import action.settings.SettingFactory.mutableSetting
import action.settings.SettingFactoryCommon.mutableSettingFlow
import action.settings.Settings
import action.settings.SettingsUpdateDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow

open class PreferenceStorageDefault(
    defaults: PreferenceDefaults,
    internal val settings: Settings,
    private val coroutineScope: CoroutineScope,
) : PreferenceStorage {
    internal val updateDispatcher = SettingsUpdateDispatcher(settings)

    override val acceptedTerms: MutableStateFlow<Boolean> =
        mutablePreferenceFlow(defaults.acceptedTerms)
    override val joinNewsletter: MutableStateFlow<Boolean> =
        mutablePreferenceFlow(defaults.joinNewsletter)
    override val reportUsageStats: MutableStateFlow<Boolean> =
        mutablePreferenceFlow(defaults.reportUsageStats)

    override val crashTrackingEnabled: MutableObservableValue<Boolean> =
        mutablePreference(defaults.crashTrackingEnabled)

    override val useMilitaryTimeFormat = mutablePreference(defaults.useMilitaryTimeFormat)

    private inline fun <reified T : Any> mutablePreferenceFlow(preferenceInfo: PreferenceInfo<T>): MutableStateFlow<T> {
        return mutableSettingFlow(preferenceInfo, settings, updateDispatcher, coroutineScope)
    }

    private inline fun <reified T : Any> mutablePreference(preferenceInfo: PreferenceInfo<T>): MutableObservableValue<T> =
        mutableSetting(preferenceInfo, settings, updateDispatcher, coroutineScope)
}
