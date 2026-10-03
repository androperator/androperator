package androperator.system.accessibility

import action.system.accessibility.SystemAccessibilityActionType
import android.accessibilityservice.AccessibilityService
import android.os.Build

val SystemAccessibilityActionType.globalAction: Int?
    get() {
        return when (this) {
            SystemAccessibilityActionType.OpenNotificationPanel -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS
                } else {
                    null
                }
            }
            SystemAccessibilityActionType.OpenQuickSettingsPanel -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS
                } else {
                    null
                }
            }
            SystemAccessibilityActionType.OpenRecentApps -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    AccessibilityService.GLOBAL_ACTION_RECENTS
                } else {
                    null
                }
            }
            SystemAccessibilityActionType.LockScreen -> {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN
                } else {
                    null
                }
            }
        }
    }
