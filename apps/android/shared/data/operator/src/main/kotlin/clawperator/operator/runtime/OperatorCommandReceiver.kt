package clawperator.operator.runtime

import action.coroutine.CoroutineScopes
import action.log.Log
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import clawperator.accessibilityservice.AccessibilityServiceManager
import clawperator.accessibilityservice.closeNotificationPanel
import clawperator.accessibilityservice.currentAccessibilityService
import clawperator.operator.agent.AgentCommandExecutor
import clawperator.operator.agent.AgentCommandParser
import clawperator.operator.agent.DirectResultConnection
import clawperator.operator.agent.EnvelopeErrorCodes
import clawperator.operator.agent.buildCanonicalFailureLine
import clawperator.task.runner.TaskResult
import clawperator.task.runner.isBackgroundServiceExecution
import kotlinx.coroutines.launch
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject

class OperatorCommandReceiver :
    BroadcastReceiver(),
    KoinComponent {
    companion object {
        const val ACTION_AGENT_COMMAND = "app.clawperator.operator.ACTION_AGENT_COMMAND"
        const val ACTION_PREPARE_RESULT_CONNECTION = "app.clawperator.operator.ACTION_PREPARE_RESULT_CONNECTION"
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
            ACTION_PREPARE_RESULT_CONNECTION -> {
                try {
                    requireNotNull(context)
                    DirectResultConnection.prepare(context.packageName, requireNotNull(intent.getStringExtra(EXTRA_AGENT_PAYLOAD)))
                } catch (_: Exception) {
                    Log.e("[Operator-Receiver] Could not prepare direct result connection")
                }
            }
            ACTION_AGENT_COMMAND -> {
                val payload = intent.getStringExtra(EXTRA_AGENT_PAYLOAD)
                if (payload.isNullOrBlank()) {
                    Log.e("[Operator-Receiver] Missing required agent payload extra: $EXTRA_AGENT_PAYLOAD")
                    return
                }

                val resultSessionId = intent.getStringExtra("result_session")
                val parsedCommand = agentCommandParser.parse(payload).map { it.copy(resultSessionId = resultSessionId) }
                if (resultSessionId != null) {
                    val command = parsedCommand.getOrNull()
                    if (command == null || !DirectResultConnection.claim(resultSessionId, command)) {
                        Log.e("[Operator-Receiver] Direct result session unavailable; command not executed")
                        return
                    }
                }
                val background = parsedCommand.getOrNull()?.actions?.isBackgroundServiceExecution() == true
                val accessibilityService = if (background) null else accessibilityServiceManager.currentAccessibilityService
                if (!background && accessibilityService == null) {
                    val reason = "Accessibility service is not available"
                    parsedCommand
                        .onSuccess { command ->
                            Log.e("[Operator-Receiver] $reason commandId=${command.commandId} taskId=${command.taskId}")
                            val canonicalFailure = buildCanonicalFailureLine(
                                commandId = command.commandId,
                                taskId = command.taskId,
                                reason = reason,
                                errorCode = EnvelopeErrorCodes.SERVICE_UNAVAILABLE,
                            )
                            if (resultSessionId != null) {
                                DirectResultConnection.publish(resultSessionId, canonicalFailure)
                            } else {
                                Log.i(canonicalFailure)
                            }
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
