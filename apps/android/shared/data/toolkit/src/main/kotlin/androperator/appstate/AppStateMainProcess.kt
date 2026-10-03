package androperator.appstate

import action.preference.MutableObservableValue
import action.time.TimeRepository
import androperator.prefs.DevicePreferenceStorage

open class AppStateMainProcess(
    val devicePreferenceStorage: DevicePreferenceStorage,
    timeRepository: TimeRepository,
) : AppState {
    override val appInstallTime: Long
        get() = devicePreferenceStorage.appInstallTime
    override val appInstallVersionCode: Long
        get() = devicePreferenceStorage.appInstallVersionCode
    override val lastAppRunVersionCode: MutableObservableValue<Long>
        get() = devicePreferenceStorage.lastAppRunVersionCode
    override val processSessionStartTime: Long = timeRepository.currentTime
    override val appShowing: Boolean
        get() = devicePreferenceStorage.appShowing.value
    override val reviewFeedItemDismissedTime: MutableObservableValue<Long>
        get() = devicePreferenceStorage.reviewFeedItemDismissedTime
    override val reviewFeedItemDismissedCount: MutableObservableValue<Int>
        get() = devicePreferenceStorage.reviewFeedItemDismissedCount
    override val inAppReviewShownOnce: MutableObservableValue<Boolean>
        get() = devicePreferenceStorage.inAppReviewShownOnce
    override val inAppReviewShownTime: MutableObservableValue<Long>
        get() = devicePreferenceStorage.inAppReviewShownTime
}
