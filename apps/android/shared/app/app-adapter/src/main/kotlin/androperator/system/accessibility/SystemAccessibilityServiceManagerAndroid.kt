package androperator.system.accessibility

import action.system.accessibility.SystemAccessibilityActionType
import action.system.accessibility.SystemAccessibilityServiceManager
import action.system.ui.controller.UiControllerManager
import action.system.ui.controller.currentActivity
import android.app.Activity
import android.content.Intent

class SystemAccessibilityServiceManagerAndroid(
    private val uiControllerManager: UiControllerManager,
) : SystemAccessibilityServiceManager {
    private val activity: Activity?
        get() = uiControllerManager.currentActivity

    override fun requestAction(systemAccessibilityActionType: SystemAccessibilityActionType) {
        val activity = activity ?: return

        val serviceIntent =
            Intent(activity, MainAccessibilityService::class.java)
                .apply {
                    putExtra(MainAccessibilityService.EXTRA_COMMAND, systemAccessibilityActionType.key)
                }

        val componentName = activity.startService(serviceIntent)
        componentName != null
    }
}
