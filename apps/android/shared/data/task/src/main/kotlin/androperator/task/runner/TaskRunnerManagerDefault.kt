package androperator.task.runner

import action.log.Log
import action.time.TimeRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext

/**
 * Default implementation of TaskRunnerManager that ensures single-concurrency execution.
 *
 * Uses a Mutex to guarantee only one task runs at a time. Handles reentrancy by detecting
 * if called from within an existing task execution and executing inline without deadlock.
 */
class TaskRunnerManagerDefault(
    private val runner: TaskRunner,
    private val timeRepository: TimeRepository,
    private val coroutineScopeMain: CoroutineScope,
) : TaskRunnerManager {
    companion object {
        private const val TAG = "[TaskRunnerManager]"
        private val ReentrancyKey = object : CoroutineContext.Key<TaskRunnerManagerDefault.ReentrancyElement> {}
    }

    private val currentTime: Long
        get() = timeRepository.currentTime

    private val mutex = Mutex()

    /**
     * Coroutine context element to track reentrancy.
     */
    private class ReentrancyElement(
        val manager: TaskRunnerManagerDefault,
    ) : AbstractCoroutineContextElement(ReentrancyKey) {
        override fun toString(): String = "ReentrancyElement(manager=$manager)"
    }

    override suspend fun <T> run(
        status: TaskStatusSink,
        block: suspend TaskScope.() -> T,
    ): TaskResult<T> {
        // Check for reentrancy - if we're already executing a task, run inline
        kotlin.coroutines.coroutineContext[ReentrancyKey]?.let { reentrancyElement ->
            if (reentrancyElement.manager === this) {
                Log.d("$TAG Reentrant call detected, executing inline")
                return runner.run(status, block)
            }
        }

        return try {
            mutex.withLock {
                Log.d("$TAG Task execution started")
                val startTime = currentTime

                val ctx =
                    coroutineScopeMain.coroutineContext.minusKey(kotlinx.coroutines.Job) +
                        ReentrancyElement(this)

                val result =
                    withContext(ctx) {
                        // Note: TaskStatusElement injection is handled by the underlying runner.run()
                        // to avoid double-injection. The runner adds TaskStatusElement(status) to its context.
                        runner.run(status, block)
                    }

                val duration = currentTime - startTime
                when (result) {
                    is TaskResult.Success -> Log.d("$TAG Task completed successfully in ${duration}ms successfully")
                    is TaskResult.Failed -> Log.e("$TAG Task failed after ${duration}ms: ${result.reason}", result.cause)
                }

                result
            }
        } catch (ce: CancellationException) {
            Log.d("$TAG Task execution cancelled")
            throw ce // Re-throw to maintain cancellation semantics
        } catch (t: Throwable) {
            Log.e("$TAG Task execution error: ${t.message}", t)
            TaskResult.Failed(reason = t.message ?: "Unknown error", cause = t)
        }
    }
}
