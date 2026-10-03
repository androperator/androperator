package androperator.preferences

import action.buildconfig.BuildConfig
import action.device.DeviceCountry
import action.device.memory.DeviceMemory
import action.time.TimeRepository
import androperator.prefs.PreferenceDefaultsProvider

open class PreferenceDefaultsProviderDefault(
    private val buildConfig: BuildConfig,
    private val showTerms: Boolean = true,
    private val timeRepository: TimeRepository,
    deviceMemory: DeviceMemory,
    deviceCountry: DeviceCountry,
) : PreferenceDefaultsProvider(deviceMemory, deviceCountry) {
    override val appInstallTime: Long
        get() = timeRepository.currentTime
    override val appInstallVersionCode: Long
        get() = buildConfig.appVersionCode
    override val reviewFeedItemDismissedCount: Int
        get() = 0
    override val acceptedTerms: Boolean
        get() = !showTerms
}
