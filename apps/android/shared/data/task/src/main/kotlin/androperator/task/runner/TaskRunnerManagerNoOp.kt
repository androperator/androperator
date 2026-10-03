package androperator.task.runner

/**
 * No-op implementation of TaskRunnerManager for testing purposes.
 *
 * Does not enforce single-concurrency - tasks run immediately without synchronization.
 * Useful for unit tests that don't need concurrency control.
 */
class TaskRunnerManagerNoOp(
    private val runner: TaskRunner = TaskRunnerNoOp(),
) : TaskRunnerManager {
    override suspend fun <T> run(
        status: TaskStatusSink,
        block: suspend TaskScope.() -> T,
    ): TaskResult<T> = runner.run(status, block)
}
