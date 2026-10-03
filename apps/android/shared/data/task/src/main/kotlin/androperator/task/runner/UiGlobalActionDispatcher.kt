package androperator.task.runner

import android.accessibilityservice.AccessibilityService
import androperator.accessibilityservice.AccessibilityServiceManager
import androperator.accessibilityservice.currentAccessibilityService

interface UiGlobalActionDispatcher {
    fun perform(key: UiSystemKey): Boolean
}

class UiGlobalActionDispatcherAndroid(
    private val accessibilityServiceManager: AccessibilityServiceManager,
) : UiGlobalActionDispatcher {
    override fun perform(key: UiSystemKey): Boolean {
        val service = accessibilityServiceManager.currentAccessibilityService
            ?: throw UiActionFailure("SERVICE_UNAVAILABLE", "OperatorAccessibilityService is not running - cannot execute press_key")

        val globalAction =
            when (key) {
                UiSystemKey.BACK -> AccessibilityService.GLOBAL_ACTION_BACK
                UiSystemKey.HOME -> AccessibilityService.GLOBAL_ACTION_HOME
                UiSystemKey.RECENTS -> AccessibilityService.GLOBAL_ACTION_RECENTS
                else -> throw UiActionFailure(
                    "UNSUPPORTED_RUNTIME_TV_REMOTE",
                    "TV remote buttons require the Androperator Node bridge",
                )
            }

        return service.performGlobalAction(globalAction)
    }
}
