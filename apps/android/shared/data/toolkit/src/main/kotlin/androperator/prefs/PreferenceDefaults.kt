package androperator.prefs

import action.preference.PreferenceInfo

open class PreferenceDefaults(
    val preferenceDefaultsProvider: PreferenceDefaultsProvider,
) {
    val appInstallTime = PreferenceInfo("pref_app_install_time", preferenceDefaultsProvider.appInstallTime)
    val appInstallVersionCode = PreferenceInfo("pref_app_install_version_code", preferenceDefaultsProvider.appInstallVersionCode)
    val lastAppRunVersionCode = PreferenceInfo("pref_last_app_run_version_code", -1L)
    val appShowing = PreferenceInfo("pref_app_showing", false)
    val acceptedTerms = PreferenceInfo("pref_accepted_terms", preferenceDefaultsProvider.acceptedTerms)
    val joinNewsletter = PreferenceInfo("pref_joinNewsletter", preferenceDefaultsProvider.joinNewsletter)
    val reportUsageStats = PreferenceInfo("pref_reportUsageStats", preferenceDefaultsProvider.reportUsageStats)
    val reviewFeedItemDismissedTime = PreferenceInfo("pref_review_feed_item_dismissed_time", REVIEW_FEED_ITEM_DISMISSED_TIME_DEFAULT)
    val reviewFeedItemDismissedCount = PreferenceInfo("pref_review_feed_item_dismissed_count", preferenceDefaultsProvider.reviewFeedItemDismissedCount)
    val inAppReviewShownOnce = PreferenceInfo("pref_in_app_review_shown_once", false)
    val inAppReviewShownTime = PreferenceInfo("pref_in_app_review_shown_time", IN_APP_REVIEW_DEFAULT_TIME)
    val crashTrackingEnabled = PreferenceInfo("pref_crash_tracking_enabled", true)
    val useMilitaryTimeFormat = PreferenceInfo("pref_use_military_time_format", preferenceDefaultsProvider.useMilitaryTimeFormat)

    companion object {
        const val REVIEW_FEED_ITEM_DISMISSED_TIME_DEFAULT = -1L
        const val IN_APP_REVIEW_DEFAULT_TIME = -1L
    }
}
