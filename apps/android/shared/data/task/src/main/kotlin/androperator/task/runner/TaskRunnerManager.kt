package androperator.task.runner

/**
 * Manages execution of tasks with single-concurrency guarantee.
 *
 * Ensures that only one task runs at a time across the process, preventing
 * conflicts when multiple UI automations try to execute simultaneously.
 */
interface TaskRunnerManager {
    /**
     * Executes a task block with mutual exclusion.
     *
     * Only one task block executes at a time. Other calls will wait
     * until the active task completes or is cancelled.
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
