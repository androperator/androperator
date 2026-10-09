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
                UiSystemKey.ROTARY_CLOCKWISE, UiSystemKey.ROTARY_COUNTERCLOCKWISE,
                UiSystemKey.ROTARY_NUDGE_UP, UiSystemKey.ROTARY_NUDGE_DOWN,
                UiSystemKey.ROTARY_NUDGE_LEFT, UiSystemKey.ROTARY_NUDGE_RIGHT,
                UiSystemKey.ROTARY_CENTER -> throw UiActionFailure(
                    "UNSUPPORTED_RUNTIME_AUTOMOTIVE_INPUT",
                    "Automotive inputs require the Androperator Node bridge",
                )
                UiSystemKey.ANDROID_AUTO_ROTARY_CLOCKWISE, UiSystemKey.ANDROID_AUTO_ROTARY_COUNTERCLOCKWISE,
                UiSystemKey.ANDROID_AUTO_NUDGE_UP, UiSystemKey.ANDROID_AUTO_NUDGE_DOWN,
                UiSystemKey.ANDROID_AUTO_NUDGE_LEFT, UiSystemKey.ANDROID_AUTO_NUDGE_RIGHT,
                UiSystemKey.ANDROID_AUTO_CENTER, UiSystemKey.ANDROID_AUTO_BACK,
                UiSystemKey.ANDROID_AUTO_HOME -> throw UiActionFailure(
                    "UNSUPPORTED_RUNTIME_ANDROID_AUTO_INPUT",
                    "Android Auto inputs require a Desktop Head Unit session managed by the Androperator Node bridge",
                )
                else -> throw UiActionFailure(
                    "UNSUPPORTED_RUNTIME_TV_REMOTE",
                    "TV remote buttons require the Androperator Node bridge",
                )
            }

        return service.performGlobalAction(globalAction)
    }
}
