package androperator.task.runner

import action.log.Log
import kotlin.time.Duration.Companion.milliseconds

/**
 * Example usage of the TaskRunner DSL as specified in the PRD.
 *
 * This demonstrates the minimal DSL for orchestrating simple sequential automation steps,
 * including optional retry/backoff functionality.
 */
suspend fun exampleTaskRunnerUsage(taskRunner: TaskRunner) {
    val result =
        taskRunner.run {
            openApp(
                "com.theswitchbot.switchbot",
                retry = TaskRetryPresets.AppLaunch,
            )

            // Wait a bit with no retry
            pause(500.milliseconds)

            // Log when the tree becomes available
            logUiTree(
                retry = TaskRetryPresets.UiReadiness,
            )
        }

    when (result) {
        is TaskResult.Success -> Log.d("[TaskRunnerExample] Task completed successfully with value: ${result.value}")
        is TaskResult.Failed -> Log.e("[TaskRunnerExample] Task failed: ${result.reason}", result.cause)
    }
}
