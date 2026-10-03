package androperator.operator.agent

import action.time.TimeRepositoryMock
import androperator.task.runner.*
import kotlinx.coroutines.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import timber.log.Timber
import kotlin.test.*

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class AgentCommandExecutorDiagnosticsTest {
    @Test
    fun `command timeout cancels through task runners and publishes one retained terminal`() = runTest {
        val lines = mutableListOf<String>()
        val logger = object : Timber.Tree() {
            override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
                if (message.startsWith(ANDROPERATOR_RESULT_PREFIX)) lines += message
            }
        }
        Timber.plant(logger)
        try {
            var actionCancelled = false
            var actionCompleted = false
            val engine = object : UiActionEngine {
                override suspend fun execute(taskScope: TaskScope, plan: UiActionPlan): UiActionExecutionResult {
                    val steps = kotlin.coroutines.coroutineContext[ActionExecutionJournal]!!.steps
                    steps += UiActionStepResult("before", "sleep")
                    try {
                        delay(1000)
                        actionCompleted = true
                    } finally {
                        actionCancelled = !currentCoroutineContext().isActive
                    }
                    return UiActionExecutionResult(plan.commandId, plan.taskId, steps)
                }
            }
            val manager = TaskRunnerManagerDefault(
                TaskRunnerDefault(TaskScopeNoOp(), backgroundScope), TimeRepositoryMock(0), backgroundScope)
            val executor = AgentCommandExecutorDefault(manager, engine)
            val result = executor.execute(AgentCommand("command", "task", "test", 50, emptyList()))
            assertIs<TaskResult.Failed>(result)
            assertTrue(actionCancelled)
            assertFalse(actionCompleted)
            assertEquals(1, lines.size)
            val envelope = Json.decodeFromString<AndroperatorResultEnvelope>(lines.single().substringAfter("$ANDROPERATOR_RESULT_PREFIX "))
            assertEquals("COMMAND_TIMEOUT", envelope.errorCode)
            assertEquals("failed", envelope.status)
            assertEquals(listOf("before"), envelope.stepResults.map { it.id })
            assertEquals("command", envelope.commandId)
            assertEquals("task", envelope.taskId)
        } finally {
            Timber.uproot(logger)
        }
    }

    @Test
    fun `external cancellation propagates and publishes exactly once`() = runTest {
        val lines = mutableListOf<String>()
        val logger = object : Timber.Tree() {
            override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
                if (message.startsWith(ANDROPERATOR_RESULT_PREFIX)) lines += message
            }
        }
        Timber.plant(logger)
        try {
            val engine = object : UiActionEngine {
                override suspend fun execute(taskScope: TaskScope, plan: UiActionPlan): UiActionExecutionResult = awaitCancellation()
            }
            val manager = TaskRunnerManagerDefault(
                TaskRunnerDefault(TaskScopeNoOp(), backgroundScope), TimeRepositoryMock(0), backgroundScope)
            val executor = AgentCommandExecutorDefault(manager, engine)
            val job = launch { executor.execute(AgentCommand("command", "task", "test", 5000, emptyList())) }
            testScheduler.runCurrent()
            job.cancelAndJoin()
            assertTrue(job.isCancelled)
            assertEquals(1, lines.size)
            val envelope = Json.decodeFromString<AndroperatorResultEnvelope>(lines.single().substringAfter("$ANDROPERATOR_RESULT_PREFIX "))
            assertEquals("COMMAND_CANCELLED", envelope.errorCode)
        } finally {
            Timber.uproot(logger)
        }
    }
}
