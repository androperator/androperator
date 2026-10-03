package androperator.task.runner

/**
 * Interface for reporting task execution progress and status.
 *
 * Implementations can be used to observe task execution in real-time,
 * enable UI feedback, or forward events to external systems.
 */
interface TaskStatusSink {
    /**
     * Emits a task execution event.
     *
     * @param event The event to emit
     */
    fun emit(event: TaskEvent)
}
