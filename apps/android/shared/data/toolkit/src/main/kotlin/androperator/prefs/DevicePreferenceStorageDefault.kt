@file:Suppress("MemberVisibilityCanBePrivate")

package androperator.prefs

import action.preference.MutableObservableValue
import action.preference.PreferenceInfo
import action.settings.SettingFactory.mutableSetting
import action.settings.SettingFactory.mutableSettingFlow
import action.settings.SettingFactory.staticSetting
import action.settings.Settings
import action.settings.SettingsUpdateDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow

open class DevicePreferenceStorageDefault(
    defaults: PreferenceDefaults,
    internal val settings: Settings,
    private val coroutineScope: CoroutineScope,
) : DevicePreferenceStorage {
    internal val updateDispatcher = SettingsUpdateDispatcher(settings)

    override val appInstallTime: Long =
        staticSetting(
            defaults.appInstallTime,
            settings,
            coroutineScope,
            initialValueResolver = { defaults.appInstallTime.default() },
        )

    override val appInstallVersionCode =
        staticSetting(
            defaults.appInstallVersionCode,
            settings,
            coroutineScope,
            initialValueResolver = { defaults.appInstallVersionCode.default() },
        )

    override val lastAppRunVersionCode: MutableObservableValue<Long> = mutablePreference(defaults.lastAppRunVersionCode)

    override val appShowing = mutablePreference(defaults.appShowing)
    override val reviewFeedItemDismissedTime = mutablePreference(defaults.reviewFeedItemDismissedTime)
    override val reviewFeedItemDismissedCount = mutablePreference(defaults.reviewFeedItemDismissedCount)
    override val inAppReviewShownOnce = mutablePreference(defaults.inAppReviewShownOnce)
    override val inAppReviewShownTime = mutablePreference(defaults.inAppReviewShownTime)

    private inline fun <reified T : Any> mutablePreferenceFlow(preferenceInfo: PreferenceInfo<T>): MutableStateFlow<T> {
        return mutableSettingFlow(preferenceInfo, settings, updateDispatcher, coroutineScope)
    }

    private inline fun <reified T : Any> mutablePreference(preferenceInfo: PreferenceInfo<T>): MutableObservableValue<T> =
        mutableSetting(preferenceInfo, settings, updateDispatcher, coroutineScope)
}
