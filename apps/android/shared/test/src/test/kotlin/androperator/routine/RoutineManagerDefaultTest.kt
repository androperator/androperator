package androperator.routine

import androperator.test.ActionTest
import androperator.test.actionTest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runCurrent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Tests for RoutineManagerDefault.
 *
 * Note regarding testing: RoutineManager uses asynchronous message passing via channels.
 * Tests must wait for routines to actually start (via CompletableDeferred signals)
 * and allow the runLoop to process messages before checking state.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RoutineManagerDefaultTest : ActionTest {

    @Test
    fun startsRoutineSuccessfully() = actionTest {
        withManager { manager ->
            val started = CompletableDeferred<Unit>()
            val completed = CompletableDeferred<Unit>()

            manager.start {
                RoutineRun(
                    routine = object : Routine {
                        override suspend fun run(routineSpec: RoutineSpec, routineStatusSink: RoutineStatusSink) {
                            started.complete(Unit)
                            completed.await()
                        }
                    },
                    routineSpec = TestRoutineSpec,
                    routineStatusSink = RoutineStatusSink.NoOp,
                )
            }

            started.await()
            assertTrue(manager.isRunning)

            completed.complete(Unit)
            runCurrent()
            assertFalse(manager.isRunning)
        }
    }

    @Test
    fun cancelsAndReplacesPreviousRoutine() = actionTest {
        withManager { manager ->
            val firstStarted = CompletableDeferred<Unit>()
            val firstCancelled = CompletableDeferred<Unit>()
            val secondStarted = CompletableDeferred<Unit>()

            manager.start {
                RoutineRun(
                    routine = object : Routine {
                        override suspend fun run(routineSpec: RoutineSpec, routineStatusSink: RoutineStatusSink) {
                            firstStarted.complete(Unit)
                            try {
                                awaitCancellation()
                            } finally {
                                firstCancelled.complete(Unit)
                            }
                        }
                    },
                    routineSpec = TestRoutineSpec,
                    routineStatusSink = RoutineStatusSink.NoOp,
                )
            }

            firstStarted.await()
            assertTrue(manager.isRunning)

            manager.start {
                RoutineRun(
                    routine = object : Routine {
                        override suspend fun run(routineSpec: RoutineSpec, routineStatusSink: RoutineStatusSink) {
                            secondStarted.complete(Unit)
                        }
                    },
                    routineSpec = TestRoutineSpec,
                    routineStatusSink = RoutineStatusSink.NoOp,
                )
            }

            firstCancelled.await()
            secondStarted.await()
            runCurrent()
            assertFalse(manager.isRunning)
        }
    }

    @Test
    fun cancelCurrentStopsActiveRoutine() = actionTest {
        withManager { manager ->
            val started = CompletableDeferred<Unit>()
            val cancelled = CompletableDeferred<Unit>()

            manager.start {
                RoutineRun(
                    routine = object : Routine {
                        override suspend fun run(routineSpec: RoutineSpec, routineStatusSink: RoutineStatusSink) {
                            started.complete(Unit)
                            try {
                                awaitCancellation()
                            } finally {
                                cancelled.complete(Unit)
                            }
                        }
                    },
                    routineSpec = TestRoutineSpec,
                    routineStatusSink = RoutineStatusSink.NoOp,
                )
            }

            started.await()
            assertTrue(manager.isRunning)

            val wasRunning = manager.cancelCurrent()
            assertTrue(wasRunning)

            cancelled.await()
            runCurrent()
            assertFalse(manager.isRunning)
        }
    }

    @Test
    fun isRunningReflectsIdleState() = actionTest {
        val manager = RoutineManagerDefault(this)
        assertFalse(manager.isRunning)
    }

    @Test
    fun routineCompletionClearsRunningFlag() = actionTest {
        withManager { manager ->
            manager.start {
                RoutineRun(
                    routine = object : Routine {
                        override suspend fun run(routineSpec: RoutineSpec, routineStatusSink: RoutineStatusSink) {
                            // complete immediately
                        }
                    },
                    routineSpec = TestRoutineSpec,
                    routineStatusSink = RoutineStatusSink.NoOp,
                )
            }
            runCurrent()
            assertFalse(manager.isRunning)
        }
    }

    @Test
    fun routineExceptionHandledAndStateReset() = actionTest {
        withManager { manager ->
            manager.start {
                RoutineRun(
                    routine = object : Routine {
                        override suspend fun run(routineSpec: RoutineSpec, routineStatusSink: RoutineStatusSink) {
                            throw IllegalStateException("boom")
                        }
                    },
                    routineSpec = TestRoutineSpec,
                    routineStatusSink = RoutineStatusSink.NoOp,
                )
            }
            assertFalse(manager.isRunning)
        }
    }

    @Test
    fun multipleStartCallsHandledSequentially() = actionTest {
        withManager { manager ->
            val executionOrder = mutableListOf<Int>()

            repeat(3) { index ->
                manager.start {
                    RoutineRun(
                        routine = object : Routine {
                            override suspend fun run(routineSpec: RoutineSpec, routineStatusSink: RoutineStatusSink) {
                                executionOrder += index
                            }
                        },
                        routineSpec = TestRoutineSpec,
                        routineStatusSink = RoutineStatusSink.NoOp,
                    )
                }
                runCurrent()
            }

            runCurrent()
            assertEquals(listOf(0, 1, 2), executionOrder)
            assertFalse(manager.isRunning)
        }
    }

    private suspend fun TestScope.withManager(
        block: suspend TestScope.(RoutineManagerDefault) -> Unit,
    ) {
        val manager = RoutineManagerDefault(this)
        val loopJob = launch { manager.runLoop() }
        try {
            block(manager)
        } finally {
            loopJob.cancel()
            loopJob.join()
        }
    }

    private object TestRoutineSpec : RoutineSpec
}
