package androperator.prefs

import action.preference.MutableObservableValue

interface DevicePreferenceStorage {
    val appInstallTime: Long

    val appInstallVersionCode: Long

    val lastAppRunVersionCode: MutableObservableValue<Long>

    val appShowing: MutableObservableValue<Boolean>

    val reviewFeedItemDismissedTime: MutableObservableValue<Long>

    val reviewFeedItemDismissedCount: MutableObservableValue<Int>

    val inAppReviewShownOnce: MutableObservableValue<Boolean>

    val inAppReviewShownTime: MutableObservableValue<Long>
}
