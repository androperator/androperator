package androperator.system.accessibility

import action.system.accessibility.SystemAccessibilityActionType
import action.system.action.SystemActionManagerAndroid
import action.system.action.SystemActionState
import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import org.koin.android.ext.android.inject

class MainAccessibilityService : AccessibilityService() {
    private val systemActionManager: SystemActionManagerAndroid by inject()

    override fun onAccessibilityEvent(event: AccessibilityEvent) { }

    override fun onInterrupt() { }

    override fun onStartCommand(
        intent: Intent?,
        flags: Int,
        startId: Int,
    ): Int {
        val cmd = intent?.getStringExtra(EXTRA_COMMAND)
        println("MainAccessibilityService.onStartCommand: $cmd")
        if (cmd != null) {
            val actionType = SystemAccessibilityActionType.fromString(cmd)
            val globalAction = actionType?.globalAction
            if (globalAction != null) {
                val result = performGlobalAction(globalAction)
                val systemActionState =
                    if (result) {
                        SystemActionState.Result.Success
                    } else {
                        SystemActionState.Result.Error
                    }
                println("MainAccessibilityService.onStartCommand: $cmd, result: $result")
                systemActionManager.setActionResult(type = actionType, result = systemActionState)
            }
        }

        return START_NOT_STICKY
    }

    companion object {
        const val EXTRA_COMMAND: String = "cmd"
    }
}
