package androperator.operator.agent

import action.log.Log
import androperator.task.runner.TaskEvent
import androperator.task.runner.TaskResult
import androperator.task.runner.TaskRunnerManager
import androperator.task.runner.TaskStatusSink
import androperator.task.runner.UiActionEngine
import androperator.task.runner.UiActionExecutionResult
import androperator.task.runner.ActionExecutionJournal
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout

class AgentCommandExecutorDefault(
    private val taskRunnerManager: TaskRunnerManager,
    private val uiActionEngine: UiActionEngine,
) : AgentCommandExecutor {
    // Serialize agent commands to prevent overlapping app transitions and mixed UI snapshots in logcat.
    private val commandExecutionMutex = Mutex()

    companion object {
        private const val TAG = "[Androperator-Command]"
        /** Message prefix for canonical-envelope build errors (not a Log tag override). */
        private const val ANDROPERATOR_RESULT_TAG = "AndroperatorResult"
    }

    override suspend fun execute(command: AgentCommand): TaskResult<UiActionExecutionResult> {
        if (commandExecutionMutex.isLocked) {
            Log.i(
                "$TAG queued commandId=${command.commandId} taskId=${command.taskId} waiting_for_active_command=true",
            )
        }

        val journal = ActionExecutionJournal()
        var terminalPublished = false
        suspend fun publish(canonicalLine: String) {
            if (terminalPublished) return
            terminalPublished = true
            publishResultEnvelope(canonicalLine, command.commandId, command.taskId)
        }
        return try {
            // Timeout intentionally includes queue wait + execution time.
            // This bounds end-to-end latency per command under contention.
            withTimeout(command.timeoutMs) {
                commandExecutionMutex.withLock {
                    val statusSink = LoggingTaskStatusSink(command.commandId, command.taskId)

                    Log.i(
                        "$TAG start commandId=${command.commandId} taskId=${command.taskId} source=${command.source} timeoutMs=${command.timeoutMs} actionCount=${command.actions.size}",
                    )

                    val result =
                        withContext(journal) {
                            taskRunnerManager.run(statusSink) {
                                uiActionEngine.execute(
                                    taskScope = this,
                                    plan = command.toPlan(),
                                )
                            }
                        }

                    when (result) {
                        is TaskResult.Success -> {
                            Log.i(
                                "$TAG success commandId=${command.commandId} taskId=${command.taskId} stepCount=${result.value.stepResults.size}",
                            )
                            try {
                                val canonicalLine = buildCanonicalSuccessLine(
                                    commandId = command.commandId,
                                    taskId = command.taskId,
                                    result = result.value,
                                )
                                // Preserve one logical canonical result while keeping each logcat record bounded.
                                publish(canonicalLine)
                            } catch (e: Throwable) {
                                Log.e(e, "$ANDROPERATOR_RESULT_TAG buildCanonicalSuccessLine failed commandId=${command.commandId}")
                            }
                        }
                        is TaskResult.Failed -> {
                            Log.e(
                                result.cause,
                                "$TAG failure commandId=${command.commandId} taskId=${command.taskId} reason=${result.reason}",
                            )
                            try {
                                val canonicalLine = buildCanonicalFailureLine(
                                    commandId = command.commandId,
                                    taskId = command.taskId,
                                    reason = result.reason,
                                    errorCode = "ACTION_FAILED",
                                    steps = journal.steps.toList(),
                                )
                                publish(canonicalLine)
                            } catch (e: Throwable) {
                                Log.e(e, "$ANDROPERATOR_RESULT_TAG buildCanonicalFailureLine failed commandId=${command.commandId}")
                            }
                        }
                    }

                    result
                }
            }
        } catch (e: CancellationException) {
            val timedOut = e is TimeoutCancellationException
            val reason = if (timedOut) "Agent command timed out after ${command.timeoutMs}ms" else "Agent command cancelled"
            try {
                val canonicalLine = buildCanonicalFailureLine(
                    commandId = command.commandId,
                    taskId = command.taskId,
                    reason = reason,
                    errorCode = if (timedOut) "COMMAND_TIMEOUT" else "COMMAND_CANCELLED",
                    steps = journal.steps.toList(),
                )
                publish(canonicalLine)
            } catch (canonicalError: Throwable) {
                Log.e(canonicalError, "$ANDROPERATOR_RESULT_TAG buildCanonicalFailureLine failed commandId=${command.commandId}")
            }
            if (!timedOut) throw e
            TaskResult.Failed(reason = reason, cause = e)
        }
    }
}

private class LoggingTaskStatusSink(
    private val commandId: String,
    private val taskId: String,
) : TaskStatusSink {
    companion object {
        private const val TAG = "[Androperator-Command]"
    }

    override fun emit(event: TaskEvent) {
        when (event) {
            is TaskEvent.StageStart -> {
                Log.d("$TAG stage-start commandId=$commandId taskId=$taskId id=${event.id} label=${event.label}")
            }
            is TaskEvent.StageSuccess -> {
                Log.d("$TAG stage-success commandId=$commandId taskId=$taskId id=${event.id} data=${event.data}")
            }
            is TaskEvent.StageFailure -> {
                Log.e(event.throwable, "$TAG stage-failure commandId=$commandId taskId=$taskId id=${event.id} reason=${event.reason}")
            }
            is TaskEvent.RetryScheduled -> {
                Log.d(
                    "$TAG stage-retry commandId=$commandId taskId=$taskId id=${event.stageId} attempt=${event.attempt}/${event.maxAttempts} delayMs=${event.nextDelayMs}",
                )
            }
            is TaskEvent.Log -> {
                Log.d("$TAG stage-log commandId=$commandId taskId=$taskId message=${event.message}")
            }
        }
    }
}
