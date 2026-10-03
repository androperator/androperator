package androperator.task.runner

import action.system.model.ApplicationId
import action.time.TimeRepositoryMock
import androperator.test.ActionTest
import androperator.test.actionTest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds

class TaskRunnerManagerTest : ActionTest {
    // Create TaskRunnerManager with test doubles so we don't pull in AppModule (which needs Context).
    private fun TestScope.createTaskRunnerManager(
        runner: TaskRunner,
    ): TaskRunnerManagerDefault =
        TaskRunnerManagerDefault(
            runner = runner,
            timeRepository = TimeRepositoryMock(),
            coroutineScopeMain = this,
        )

    // Test implementation of TaskRunner that allows control over execution
    class TestTaskRunner(
        private val executionTime: Long = 0,
        private val result: TaskResult<Unit> = TaskResult.Success(Unit),
        private val shouldThrow: Throwable? = null,
    ) : TaskRunner {
        var executionCount = 0
            private set

        var concurrentExecutions = 0
            private set

        override suspend fun <T> run(
            status: TaskStatusSink,
            block: suspend TaskScope.() -> T,
        ): TaskResult<T> {
            executionCount++
            concurrentExecutions++

            try {
                if (shouldThrow != null) {
                    throw shouldThrow
                }

                if (executionTime > 0) {
                    delay(executionTime)
                }

                // Execute the block
                val testScope = TestTaskScope()
                val blockResult = testScope.block()

                @Suppress("UNCHECKED_CAST")
                return when (result) {
                    is TaskResult.Success -> TaskResult.Success(blockResult)
                    is TaskResult.Failed -> result as TaskResult<T>
                }
            } finally {
                concurrentExecutions--
            }
        }
    }

    // Simple test TaskScope implementation
    class TestTaskScope : TaskScope {
        override suspend fun openApp(
            applicationId: ApplicationId,
            retry: TaskRetry,
        ) {
            // No-op for testing
        }

        override suspend fun openUri(
            uri: String,
            retry: TaskRetry,
        ) {
            // No-op for testing
        }

        override suspend fun pause(
            duration: Duration,
            retry: TaskRetry,
        ) {
            delay(duration)
        }

        override suspend fun logUiTree(
            retry: TaskRetry,
        ): UiSnapshotResult {
            // No-op for testing
            return UiSnapshotResult(actualFormat = UiSnapshotActualFormat.HierarchyXml)
        }

        override suspend fun closeApp(
            applicationId: ApplicationId,
            retry: TaskRetry,
        ) {
            // No-op for testing
        }

        override suspend fun waitForNavigation(
            expectedPackage: String?,
            expectedNode: NodeMatcher?,
            timeoutMs: Long,
            allowAlreadyForeground: Boolean,
        ): WaitForNavigationResult {
            // No-op for testing
            return WaitForNavigationResult(success = false, lastPackage = null, elapsedMs = 0)
        }

        override suspend fun <T> ui(block: suspend TaskUiScope.() -> T): T {
            // No-op for testing - return Unit cast to T
            @Suppress("UNCHECKED_CAST")
            return Unit as T
        }
    }

    @Test
    fun `single run passes through to underlying runner`() =
        actionTest {
            val testRunner = TestTaskRunner()
            val manager = createTaskRunnerManager(testRunner)

            val result =
                manager.run {
                    pause(10.milliseconds)
                }

            assertTrue(result is TaskResult.Success && result.value == Unit)
            assertEquals(1, testRunner.executionCount)
        }

    @Test
    fun `mutual exclusion - only one task runs at a time`() =
        actionTest {
            val testRunner = TestTaskRunner(executionTime = 100) // 100ms execution time
            val manager = createTaskRunnerManager(testRunner)

            val results = mutableListOf<TaskResult<Unit>>()

            // Launch two tasks concurrently
            val job1 =
                async(start = CoroutineStart.UNDISPATCHED) {
                    manager
                        .run {
                            pause(10.milliseconds)
                        }.also { results.add(it) }
                }

            val job2 =
                async(start = CoroutineStart.UNDISPATCHED) {
                    manager
                        .run {
                            pause(10.milliseconds)
                        }.also { results.add(it) }
                }

            job1.await()
            job2.await()

            // Both should succeed
            assertEquals(2, results.size)
            assertTrue(results.all { it is TaskResult.Success && it.value == Unit })

            // Only one execution at a time (no concurrent executions detected)
            assertEquals(0, testRunner.concurrentExecutions)

            // Both tasks should have executed
            assertEquals(2, testRunner.executionCount)
        }

    @Test
    fun `cancellation while queued returns Failed with Cancelled reason`() =
        actionTest {
            val firstTaskStarted = CompletableDeferred<Unit>()
            val firstTaskContinue = CompletableDeferred<Unit>()

            val testRunner =
                object : TaskRunner {
                    override suspend fun <T> run(
                        status: TaskStatusSink,
                        block: suspend TaskScope.() -> T,
                    ): TaskResult<T> {
                        firstTaskStarted.complete(Unit)
                        firstTaskContinue.await() // Wait until we're told to continue
                        return TaskResult.Success(Unit as T)
                    }
                }

            val manager = createTaskRunnerManager(testRunner)

            // Start first task (will hold the lock)
            val firstTaskJob =
                async {
                    manager.run {
                        pause(10.milliseconds)
                    }
                }

            // Wait for first task to start
            firstTaskStarted.await()

            // Start second task that should queue
            val secondTaskJob =
                async {
                    manager.run {
                        pause(10.milliseconds)
                    }
                }

            // Cancel the second task while it's queued
            secondTaskJob.cancel()

            // Let the first task complete
            firstTaskContinue.complete(Unit)
            firstTaskJob.await()

            // Second task should complete with cancellation
            assertTrue(secondTaskJob.isCancelled)
        }

    @Test
    fun `cancellation while running propagates to underlying runner`() =
        actionTest {
            val testRunner = TestTaskRunner(executionTime = 1000) // Long execution
            val manager = createTaskRunnerManager(testRunner)

            val job =
                async {
                    manager.run {
                        pause(100.milliseconds)
                    }
                }

            // Give it a moment to start
            delay(50)

            // Cancel the job
            job.cancelAndJoin()

            // Job should be cancelled
            assertTrue(job.isCancelled)
        }

    @Test
    fun `exception propagation returns Failed result`() =
        actionTest {
            val testException = RuntimeException("Test exception")
            val testRunner = TestTaskRunner(shouldThrow = testException)
            val manager = createTaskRunnerManager(testRunner)

            val result =
                manager.run {
                    pause(10.milliseconds)
                }

            assertIs<TaskResult.Failed>(result)
            // TaskRunnerManager passes through the exception message
            assertEquals("Test exception", result.reason)
            // Verify the cause is the same exception (check type and message instead of reference equality)
            assertIs<RuntimeException>(result.cause)
            assertEquals("Test exception", result.cause?.message)
        }

    @Test
    fun `reentrancy allows nested calls without deadlock`() =
        actionTest {
            var outerExecuted = false
            var innerExecuted = false

            val testRunner =
                object : TaskRunner {
                    override suspend fun <T> run(
                        status: TaskStatusSink,
                        block: suspend TaskScope.() -> T,
                    ): TaskResult<T> {
                        val scope = TestTaskScope()
                        val result = scope.block()
                        return TaskResult.Success(result)
                    }
                }

            val manager = createTaskRunnerManager(testRunner)

            val result =
                manager.run {
                    outerExecuted = true
                    // Nested call - should execute inline without deadlock
                    manager.run {
                        innerExecuted = true
                        Unit // Explicitly return Unit
                    }
                    Unit // Outer block also returns Unit
                }

            assertTrue(result is TaskResult.Success && result.value == Unit)
            assertTrue(outerExecuted)
            assertTrue(innerExecuted)
        }

    @Test
    fun `mutual exclusion - no concurrent task execution`() =
        actionTest {
            val completedTasks = mutableListOf<Int>()
            val testRunner = TestTaskRunner()

            val manager = createTaskRunnerManager(testRunner)

            val results = mutableListOf<TaskResult<Unit>>()

            // Launch three tasks concurrently
            val job1 =
                async(start = CoroutineStart.UNDISPATCHED) {
                    manager
                        .run {
                            completedTasks.add(1)
                            Unit // Explicitly return Unit
                        }.also { results.add(it) }
                }

            val job2 =
                async(start = CoroutineStart.UNDISPATCHED) {
                    manager
                        .run {
                            completedTasks.add(2)
                            Unit // Explicitly return Unit
                        }.also { results.add(it) }
                }

            val job3 =
                async(start = CoroutineStart.UNDISPATCHED) {
                    manager
                        .run {
                            completedTasks.add(3)
                            Unit // Explicitly return Unit
                        }.also { results.add(it) }
                }

            job1.await()
            job2.await()
            job3.await()

            // All tasks should complete successfully
            assertEquals(3, results.size)
            assertTrue(results.all { it is TaskResult.Success && it.value == Unit })

            // All tasks should have been executed
            assertEquals(3, completedTasks.size)
            assertTrue(completedTasks.containsAll(listOf(1, 2, 3)))

            // Verify no concurrent execution occurred (mutex worked)
            assertEquals(0, testRunner.concurrentExecutions)
        }

    @Test
    fun `TaskRunnerManagerNoOp delegates to underlying runner without synchronization`() =
        actionTest {
            val testRunner = TestTaskRunner()
            val manager = TaskRunnerManagerNoOp(testRunner)

            val result =
                manager.run {
                    pause(10.milliseconds)
                }

            assertTrue(result is TaskResult.Success && result.value == Unit)
            assertEquals(1, testRunner.executionCount)
        }
}
