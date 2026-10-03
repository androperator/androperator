package androperator.task.runner

/**
 * No-op implementation that silently ignores all events.
 * Useful for default parameter values and testing.
 */
class TaskStatusSinkNoOp : TaskStatusSink {
    override fun emit(event: TaskEvent) = Unit
}
