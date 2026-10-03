package androperator.operator.task

/**
 * Service for reporting task status updates to local agent-observable logs.
 */
interface TaskStatusReporter {
    /**
     * Report a task status update.
     */
    suspend fun reportStatus(
        taskId: String,
        deviceId: String,
        status: String,
        message: String,
        progressPct: Int? = null,
        result: String? = null,
        errorCode: String? = null,
    ): Result<Unit>
}
