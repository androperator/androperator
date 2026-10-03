package androperator.task.runner

/**
 * Sealed interface representing different types of task execution events.
 *
 * These events provide visibility into the automation workflow, enabling
 * real-time progress tracking, debugging, and user feedback.
 */
sealed interface TaskEvent {
    /**
     * Emitted when a task stage begins execution.
     *
     * @param id Unique identifier for this stage (e.g., "openApp:com.example.app")
     * @param label Human-readable description (e.g., "Opening Google Home")
     * @param ordinal Optional position in sequence (1-based)
     * @param total Optional total number of stages for progress indication
     */
    data class StageStart(
        val id: String,
        val label: String,
        val ordinal: Int? = null,
        val total: Int? = null,
    ) : TaskEvent

    /**
     * Emitted when a task stage completes successfully.
     *
     * @param id Unique identifier matching the corresponding StageStart
     * @param data Optional key-value data about the successful operation
     */
    data class StageSuccess(
        val id: String,
        val data: Map<String, String> = emptyMap(),
    ) : TaskEvent

    /**
     * Emitted when a task stage fails permanently (after all retries exhausted).
     *
     * @param id Unique identifier matching the corresponding StageStart
     * @param reason Human-readable failure description
     * @param throwable Optional exception that caused the failure
     * @param errorClass Portable error class name (for serialization across platforms)
     * @param errorMessage Portable error message (for serialization across platforms)
     * @param stackSummary First line of stack trace (for debugging without full Throwable)
     */
    data class StageFailure(
        val id: String,
        val reason: String,
        val throwable: Throwable? = null,
        val errorClass: String? = throwable?.let { it::class.simpleName },
        val errorMessage: String? = throwable?.message,
        val stackSummary: String? = throwable?.stackTraceToString()?.lines()?.firstOrNull(),
    ) : TaskEvent

    /**
     * Emitted when a retry is scheduled due to a stage failure.
     *
     * @param stageId Unique identifier of the stage being retried
     * @param attempt The attempt number (1-based)
     * @param maxAttempts Total number of attempts allowed
     * @param nextDelayMs Delay before the next retry attempt in milliseconds
     */
    data class RetryScheduled(
        val stageId: String,
        val attempt: Int,
        val maxAttempts: Int,
        val nextDelayMs: Long,
    ) : TaskEvent

    /**
     * Emitted for informational logging during task execution.
     *
     * @param message The log message
     */
    data class Log(
        val message: String,
    ) : TaskEvent
}
