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
    fun `blocking lookup cannot dispatch queued Back after command deadline`() = runTest {
        val lines = mutableListOf<String>()
        val logger = object : Timber.Tree() {
            override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
                if (message.startsWith(ANDROPERATOR_RESULT_PREFIX)) lines += message
            }
        }
        Timber.plant(logger)
        try {
            var backCalls = 0
            val scope = object : TaskScope by TaskScopeNoOp() {
                override suspend fun waitForNavigation(expectedPackage: String?, expectedNode: NodeMatcher?, timeoutMs: Long, allowAlreadyForeground: Boolean): WaitForNavigationResult {
                    Thread.sleep(80) // The cooperative timeout cannot run on this dispatcher.
                    return WaitForNavigationResult(true, "com.example.target", 80)
                }
            }
            val developerOptions = java.lang.reflect.Proxy.newProxyInstance(
                action.developeroptions.DeveloperOptionsManager::class.java.classLoader,
                arrayOf(action.developeroptions.DeveloperOptionsManager::class.java),
            ) { _, _, _ -> error("Unexpected developer-options access") } as action.developeroptions.DeveloperOptionsManager
            val dispatcher = object : UiGlobalActionDispatcher {
                override fun perform(key: UiSystemKey): Boolean { backCalls++; return true }
            }
            val manager = TaskRunnerManagerDefault(TaskRunnerDefault(scope, backgroundScope), TimeRepositoryMock(0), backgroundScope)
            val executor = AgentCommandExecutorDefault(manager, UiActionEngineDefault(developerOptions, dispatcher))
            val result = executor.execute(AgentCommand("command", "task", "test", 20, listOf(
                UiAction.WaitForNavigation("wait", "com.example.target", null, 10),
                UiAction.PressKey("back", UiSystemKey.BACK),
            )))
            assertEquals(0, backCalls)
            assertIs<TaskResult.Failed>(result)
            assertEquals(1, lines.size)
            val envelope = Json.decodeFromString<AndroperatorResultEnvelope>(lines.single().substringAfter("$ANDROPERATOR_RESULT_PREFIX "))
            assertEquals("COMMAND_TIMEOUT", envelope.errorCode)
            assertEquals(listOf("wait"), envelope.stepResults.map { it.id })
            assertEquals("COMMAND_TIMEOUT", envelope.stepResults.single().data["errorCode"])
        } finally { Timber.uproot(logger) }
    }

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
