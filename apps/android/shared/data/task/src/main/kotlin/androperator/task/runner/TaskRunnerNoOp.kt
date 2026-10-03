package androperator.task.runner

class TaskRunnerNoOp : TaskRunner {
    override suspend fun <T> run(
        status: TaskStatusSink,
        block: suspend TaskScope.() -> T,
    ): TaskResult<T> {
        // execute the block with a no-op scope and return its value
        val scope = TaskScopeNoOp()
        return try {
            TaskResult.Success(scope.block())
        } catch (e: Exception) {
            TaskResult.Failed("TaskRunnerNoOp failure: ${e.message}", e)
        }
    }
}
