package androperator.operator.task

import androperator.task.runner.TaskResult

/**
 * DSL extensions for TaskStatusReporter to provide convenient methods for common status updates.
 */

/**
 * Reports that a task has been received.
 */
suspend fun TaskStatusReporter.received(
    taskId: String,
    deviceId: String,
    message: String = "FCM received",
): Result<Unit> =
    reportStatus(
        taskId = taskId,
        deviceId = deviceId,
        status = "received",
        message = message,
    )

/**
 * Reports that a task has started execution.
 */
suspend fun TaskStatusReporter.started(
    taskId: String,
    deviceId: String,
    message: String,
): Result<Unit> =
    reportStatus(
        taskId = taskId,
        deviceId = deviceId,
        status = "started",
        message = message,
    )

/**
 * Reports progress on a task.
 */
suspend fun TaskStatusReporter.progress(
    taskId: String,
    deviceId: String,
    message: String,
    progressPct: Int,
): Result<Unit> =
    reportStatus(
        taskId = taskId,
        deviceId = deviceId,
        status = "progress",
        message = message,
        progressPct = progressPct,
    )

/**
 * Reports that a task has finished successfully.
 */
suspend fun TaskStatusReporter.finished(
    taskId: String,
    deviceId: String,
    message: String,
    result: String? = null,
): Result<Unit> =
    reportStatus(
        taskId = taskId,
        deviceId = deviceId,
        status = "finished",
        message = message,
        result = result,
    )

/**
 * Reports that a task has failed.
 */
suspend fun TaskStatusReporter.failed(
    taskId: String,
    deviceId: String,
    message: String,
    errorCode: String? = null,
): Result<Unit> =
    reportStatus(
        taskId = taskId,
        deviceId = deviceId,
        status = "failed",
        message = message,
        errorCode = errorCode,
    )

/**
 * Wraps task execution with standard status reporting flow.
 *
 * Reports "received" at the start, then executes the block.
 * If successful, reports "finished" (optionally with payload if successResultToString is provided).
 * If the block fails or returns a failed TaskResult, reports "failed".
 * If an exception is thrown, catches it and reports "failed" with EXEC_EXCEPTION.
 *
 * @param taskId The task ID
 * @param deviceId The device ID
 * @param startedMessage The message to report when starting execution
 * @param successMessage The message to report on success
 * @param successResultToString Optional mapper to convert success result to string for reporting as payload
 * @param block The block of code to execute
 * @return The result of the execution block
 */
suspend inline fun <T> TaskStatusReporter.wrapTaskResult(
    taskId: String,
    deviceId: String,
    startedMessage: String,
    successMessage: String,
    noinline successResultToString: ((T) -> String)? = null,
    block: suspend () -> TaskResult<T>,
): TaskResult<T> =
    try {
        received(taskId, deviceId)
        started(taskId, deviceId, startedMessage)

        val result = block()
        when (result) {
            is TaskResult.Success -> {
                val payload = successResultToString?.invoke(result.value)
                finished(taskId, deviceId, successMessage, payload)
                result
            }
            is TaskResult.Failed -> {
                failed(taskId, deviceId, result.reason, "WORKFLOW_ERROR")
                result
            }
        }
    } catch (e: Exception) {
        failed(taskId, deviceId, "Exception during execution: ${e.message}", "EXEC_EXCEPTION")
        TaskResult.Failed("Exception during execution: ${e.message}", e)
    }
