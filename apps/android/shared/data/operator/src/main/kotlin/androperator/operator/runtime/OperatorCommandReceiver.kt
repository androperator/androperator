package androperator.operator.runtime

import action.coroutine.CoroutineScopes
import action.log.Log
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androperator.accessibilityservice.AccessibilityServiceManager
import androperator.accessibilityservice.closeNotificationPanel
import androperator.accessibilityservice.currentAccessibilityService
import androperator.operator.agent.AgentCommandExecutor
import androperator.operator.agent.AgentCommandParser
import androperator.operator.agent.EnvelopeErrorCodes
import androperator.operator.agent.buildCanonicalFailureLine
import androperator.task.runner.TaskResult
import androperator.task.runner.isBackgroundServiceExecution
import kotlinx.coroutines.launch
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject

class OperatorCommandReceiver :
    BroadcastReceiver(),
    KoinComponent {
    companion object {
        const val ACTION_AGENT_COMMAND = "app.androperator.operator.ACTION_AGENT_COMMAND"
        const val EXTRA_AGENT_PAYLOAD = "payload"
    }

    val accessibilityServiceManager: AccessibilityServiceManager by inject()
    val coroutineScopes: CoroutineScopes by inject()
    val agentCommandParser: AgentCommandParser by inject()
    val agentCommandExecutor: AgentCommandExecutor by inject()

    override fun onReceive(
        context: Context?,
        intent: Intent?,
    ) {
        when (intent?.action) {
            ACTION_AGENT_COMMAND -> {
                val payload = intent.getStringExtra(EXTRA_AGENT_PAYLOAD)
                if (payload.isNullOrBlank()) {
                    Log.e("[Operator-Receiver] Missing required agent payload extra: $EXTRA_AGENT_PAYLOAD")
                    return
                }

                val parsedCommand = agentCommandParser.parse(payload)
                val background = parsedCommand.getOrNull()?.actions?.isBackgroundServiceExecution() == true
                val accessibilityService = if (background) null else accessibilityServiceManager.currentAccessibilityService
                if (!background && accessibilityService == null) {
                    val reason = "Accessibility service is not available"
                    parsedCommand
                        .onSuccess { command ->
                            Log.e("[Operator-Receiver] $reason commandId=${command.commandId} taskId=${command.taskId}")
                            Log.i(
                                buildCanonicalFailureLine(
                                    commandId = command.commandId,
                                    taskId = command.taskId,
                                    reason = reason,
                                    errorCode = EnvelopeErrorCodes.SERVICE_UNAVAILABLE,
                                ),
                            )
                        }.onFailure { error ->
                            Log.e(error, "[Operator-Receiver] $reason and failed to parse agent command payload")
                        }
                    return
                }

                if (!background && accessibilityService != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    accessibilityService.closeNotificationPanel()
                }

                coroutineScopes.main.launch {
                    parsedCommand
                        .onSuccess { command ->
                            val result = agentCommandExecutor.execute(command)
                            when (result) {
                                is TaskResult.Success -> {
                                    Log.d(
                                        "[Operator-Receiver] Agent command completed successfully commandId=${command.commandId} taskId=${command.taskId}",
                                    )
                                }
                                is TaskResult.Failed -> {
                                    Log.e(
                                        "[Operator-Receiver] Agent command failed commandId=${command.commandId} taskId=${command.taskId}: ${result.reason}",
                                        result.cause,
                                    )
                                }
                            }
                        }.onFailure { error ->
                            Log.e(error, "[Operator-Receiver] Failed to parse agent command payload")
                        }
                }
            }
            else -> {
                Log.d("[Operator-Receiver] Ignoring unsupported action=${intent?.action}")
            }
        }
    }
}
