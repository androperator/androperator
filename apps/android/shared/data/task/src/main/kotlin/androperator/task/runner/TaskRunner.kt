package androperator.task.runner

interface TaskRunner {
    /**
     * Executes a task block and returns the result.
     *
     * @param status Optional sink for reporting task execution progress and events.
     *               Defaults to NoOp for backward compatibility.
     * @param block The task operations to execute within a TaskScope
     * @return TaskResult<T> indicating success with value or failure
     */
    suspend fun <T> run(
        status: TaskStatusSink = TaskStatusSinkNoOp(),
        block: suspend TaskScope.() -> T,
    ): TaskResult<T>
}
