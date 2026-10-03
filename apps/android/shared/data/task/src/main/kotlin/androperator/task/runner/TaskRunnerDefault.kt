package androperator.task.runner

import action.log.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext

class TaskRunnerDefault(
    private val taskScope: TaskScope,
    private val coroutineScopeMain: CoroutineScope,
) : TaskRunner {
    companion object {
        private const val TAG = "[TaskRunner]"
    }

    override suspend fun <T> run(
        status: TaskStatusSink,
        block: suspend TaskScope.() -> T,
    ): TaskResult<T> =
        try {
            val result =
                withContext(coroutineScopeMain.coroutineContext.minusKey(kotlinx.coroutines.Job) + TaskStatusElement(status)) {
                    coroutineScope {
                        taskScope.block()
                    }
                }
            TaskResult.Success(result)
        } catch (ce: CancellationException) {
            throw ce
        } catch (e: Exception) {
            Log.e(TAG, "Task execution failed", e)
            TaskResult.Failed(
                reason = "Task execution failed: ${e.message}",
                cause = e,
            )
        }
}
