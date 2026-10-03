package androperator.prefs

import action.device.DeviceCountry
import action.device.DeviceCountryMock
import action.device.memory.DeviceMemory
import action.device.memory.DeviceMemoryMock
import action.language.isEnglishLanguage
import action.time.getCurrentTimeMillis

/**
 * Provides default preference values. Useful for values that need to be configured at runtime,
 * on a per-flavor basis, etc.
 */
abstract class PreferenceDefaultsProvider(
    private val deviceMemory: DeviceMemory,
    private val deviceCountry: DeviceCountry,
) {
    abstract val appInstallTime: Long

    abstract val appInstallVersionCode: Long

    open val reviewFeedItemDismissedCount: Int
        get() = 0

    open val enableZoomPan: Boolean
        get() = false

    open val acceptedTerms: Boolean
        get() = false

    open val joinNewsletter: Boolean
        get() = false

    open val reportUsageStats: Boolean
        get() = true

    open val useMilitaryTimeFormat: Boolean
        get() = deviceCountry.resolveBestCountryIso()?.isEnglishLanguage() == false
}

open class PreferenceDefaultsProviderMock(
    override val appInstallTime: Long = getCurrentTimeMillis(),
    override val appInstallVersionCode: Long = 0L,
    override val acceptedTerms: Boolean = false,
    deviceMemory: DeviceMemoryMock = DeviceMemoryMock(),
    deviceCountry: DeviceCountry = DeviceCountryMock(),
) : PreferenceDefaultsProvider(deviceMemory, deviceCountry)
