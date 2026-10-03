package androperator.appstate

import action.preference.MutableObservableValue

/**
 * Houses app state related variables that persist between app sessions.
 */
interface AppState {
    val appInstallTime: Long
    val appInstallVersionCode: Long

    val lastAppRunVersionCode: MutableObservableValue<Long>

    val processSessionStartTime: Long

    /**
     * Do you mean to use [action.appvisibility.AppVisibility.isVisible] instead?
     */
    val appShowing: Boolean

    val reviewFeedItemDismissedTime: MutableObservableValue<Long>
    val reviewFeedItemDismissedCount: MutableObservableValue<Int>
    val inAppReviewShownOnce: MutableObservableValue<Boolean>
    val inAppReviewShownTime: MutableObservableValue<Long>
}
