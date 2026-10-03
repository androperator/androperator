package androperator.routine.airconditioner

import action.time.TimeRepositoryMock
import androperator.routine.RecordingRoutineStatusSink
import androperator.task.runner.TaskResult
import androperator.task.runner.TaskStatusSinkNoOp
import androperator.task.runner.valueOrNull
import androperator.test.ActionTest
import androperator.test.actionTest
import androperator.uitree.ToggleState
import androperator.workflow.WorkflowManagerMock
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlin.time.Duration
import kotlin.time.Duration.Companion.hours
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

class AirConditionerRunForDurationRoutineTest : ActionTest {

    private fun createRoutine(
        timeRepository: TimeRepositoryMock,
        workflowManager: WorkflowManagerMock,
    ) = AirConditionerRunForDurationRoutine(
        timeRepository = timeRepository,
        workflowManager = workflowManager,
    )

    private fun TestScope.advanceByWithTimeUpdate(
        timeRepository: TimeRepositoryMock,
        duration: Duration
    ) {
        timeRepository._currentTime += duration.inWholeMilliseconds
        timeRepository._elapsedRealtime += duration.inWholeMilliseconds
        advanceTimeBy(duration.inWholeMilliseconds)
    }

    @Test
    fun `turns on then off after duration`() = actionTest {
        val time = TimeRepositoryMock()
        val wm = WorkflowManagerMock().apply { setAirConditionerState(ToggleState.Off) }
        val sink = RecordingRoutineStatusSink()
        val spec = AirConditionerRunForDurationRoutineSpec(
            runDuration = 2.minutes,
            startState = ToggleState.On,
            endState = ToggleState.Off
        )
        val routine = createRoutine(time, wm)

        val job = launch { routine.run(spec, sink) }

        // Should turn on immediately
        advanceTimeBy(1.seconds)
        assertEquals(ToggleState.On, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        // Jump to end - advance test time and time repository time together
        advanceByWithTimeUpdate(time, 2.minutes + 1.seconds)

        assertEquals(ToggleState.Off, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)
        assertTrue(sink.logs.any { it.message == "state_transition" && it.data["reason"] == "run_complete" })

        job.cancel()
    }

    @Test
    fun `no redundant on when already on`() = actionTest {
        val time = TimeRepositoryMock()
        val wm = WorkflowManagerMock().apply {
            setAirConditionerState(ToggleState.On)
            // Set up to fail if setAirConditionerStatus is called (it shouldn't be)
            nextSetAirConditionerResult = TaskResult.Failed("Should not be called")
        }
        val spec = AirConditionerRunForDurationRoutineSpec(
            runDuration = 1.minutes,
            startState = ToggleState.On,
            endState = ToggleState.Off,
            skipRedundantStart = true
        )
        val routine = createRoutine(time, wm)

        val job = launch { routine.run(spec, RecordingRoutineStatusSink()) }

        // Advance time and ensure no state change occurs
        advanceTimeBy(5.seconds)
        assertEquals(ToggleState.On, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        job.cancel()
    }

    @Test
    fun `write failure logged when turning on fails`() = actionTest {
        val time = TimeRepositoryMock()
        val wm = WorkflowManagerMock().apply {
            setAirConditionerState(ToggleState.Off)
            nextSetAirConditionerResult = TaskResult.Failed("AC control failed")
        }
        val sink = RecordingRoutineStatusSink()
        val spec = AirConditionerRunForDurationRoutineSpec(
            runDuration = 10.minutes,
            startState = ToggleState.On,
            endState = ToggleState.Off
        )
        val routine = createRoutine(time, wm)

        val job = launch { routine.run(spec, sink) }

        // Attempt to turn ON should fail and routine should exit
        advanceTimeBy(1.seconds)
        assertEquals(
            ToggleState.Off,
            wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        ) // State unchanged

        // Failure event recorded
        assertTrue(sink.stages.any { it.type == "failure" && it.id == "start_on" })

        job.cancel()
    }

    @Test
    fun `negative duration rejected`() = actionTest {
        assertFailsWith<IllegalArgumentException> {
            AirConditionerRunForDurationRoutineSpec(
                runDuration = (-1).seconds,
                startState = ToggleState.On,
                endState = ToggleState.Off
            )
        }.message?.contains("runDuration must be >= 0")
    }

    @Test
    fun `zero duration turns off immediately`() = actionTest {
        val time = TimeRepositoryMock()
        val wm = WorkflowManagerMock().apply { setAirConditionerState(ToggleState.On) }
        val sink = RecordingRoutineStatusSink()
        val spec = AirConditionerRunForDurationRoutineSpec(
            runDuration = 0.seconds,
            startState = ToggleState.On,
            endState = ToggleState.Off
        )
        val routine = createRoutine(time, wm)

        val job = launch { routine.run(spec, sink) }

        // Should immediately turn Off and exit
        advanceTimeBy(1.seconds)
        assertEquals(ToggleState.Off, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)
        assertTrue(sink.logs.any { it.message == "state_transition" && it.data["reason"] == "run_complete" })

        job.cancel()
    }

    @Test
    fun `zero duration turns off immediately when already off`() = actionTest {
        val time = TimeRepositoryMock()
        val wm = WorkflowManagerMock().apply { setAirConditionerState(ToggleState.Off) }
        val sink = RecordingRoutineStatusSink()
        val spec = AirConditionerRunForDurationRoutineSpec(
            runDuration = 0.seconds,
            startState = ToggleState.On,
            endState = ToggleState.Off,
            skipRedundantStart = true
        )
        val routine = createRoutine(time, wm)

        val job = launch { routine.run(spec, sink) }

        // Should not turn On, and should still try to turn Off (no-op since already Off)
        advanceTimeBy(1.seconds)
        assertEquals(ToggleState.Off, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)
        assertTrue(sink.logs.any { it.message == "state_transition" && it.data["reason"] == "run_complete" })

        job.cancel()
    }

    @Test
    fun `two-hour window crossing date boundary uses monotonic timing`() = actionTest {
        val time = TimeRepositoryMock()
        val wm = WorkflowManagerMock().apply { setAirConditionerState(ToggleState.Off) }
        val sink = RecordingRoutineStatusSink()

        // We'll simulate starting and running for 2 hours using monotonic elapsed time
        val spec = AirConditionerRunForDurationRoutineSpec(
            runDuration = 2.hours,
            startState = ToggleState.On,
            endState = ToggleState.Off
        )
        val routine = createRoutine(time, wm)

        val job = launch { routine.run(spec, sink) }

        // Should turn On immediately
        advanceTimeBy(1.seconds)
        assertEquals(ToggleState.On, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        // Advance 1 hour 50 minutes (crossing midnight in wall time doesn't matter)
        advanceByWithTimeUpdate(time, 1.hours + 50.minutes)
        assertEquals(ToggleState.On, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        // Advance the remaining 10 minutes to reach exactly 2 hours
        advanceByWithTimeUpdate(time, 10.minutes)
        assertEquals(ToggleState.Off, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        // Should have logged the completion
        assertTrue(sink.logs.any { it.message == "state_transition" && it.data["reason"] == "run_complete" })

        job.cancel()
    }

    @Test
    fun `cancellation exits promptly with best-effort off cleanup`() = actionTest {
        val time = TimeRepositoryMock()
        val wm = WorkflowManagerMock().apply { setAirConditionerState(ToggleState.Off) }
        val sink = RecordingRoutineStatusSink()
        val spec = AirConditionerRunForDurationRoutineSpec(
            runDuration = 10.minutes,
            startState = ToggleState.On,
            endState = ToggleState.Off
        )
        val routine = createRoutine(time, wm)

        val job = launch { routine.run(spec, sink) }

        // Should turn On immediately
        advanceTimeBy(1.seconds)
        assertEquals(ToggleState.On, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        // Cancel before completion
        advanceTimeBy(30.seconds)
        job.cancel()

        // Give time for cleanup
        advanceTimeBy(1.seconds)

        // Should have turned Off during cleanup
        assertEquals(ToggleState.Off, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        // Should have logged cleanup transition
        assertTrue(sink.logs.any { it.message == "state_transition" && it.data["reason"] == "cancelled_cleanup" })
    }

    @Test
    fun `cancellation before turning on does nothing`() = actionTest {
        val time = TimeRepositoryMock()
        val wm = WorkflowManagerMock().apply { setAirConditionerState(ToggleState.Off) }
        val sink = RecordingRoutineStatusSink()
        val spec = AirConditionerRunForDurationRoutineSpec(
            runDuration = 10.minutes,
            startState = ToggleState.On,
            endState = ToggleState.Off
        )
        val routine = createRoutine(time, wm)

        val job = launch { routine.run(spec, sink) }

        // Cancel immediately before any state changes
        job.cancel()

        // Give time for any potential cleanup
        advanceTimeBy(1.seconds)

        // Should not have changed state
        assertEquals(ToggleState.Off, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        // Should not have logged any transitions
        assertTrue(sink.logs.none { it.message == "state_transition" })
    }

    @Test
    fun `read failure at start attempts turn on anyway`() = actionTest {
        val time = TimeRepositoryMock()
        val wm = WorkflowManagerMock().apply {
            setAirConditionerState(ToggleState.Off)
            // Fail the initial read
            nextGetAirConditionerResult = TaskResult.Failed("AC status sensor failed")
        }
        val sink = RecordingRoutineStatusSink()
        val spec = AirConditionerRunForDurationRoutineSpec(
            runDuration = 10.minutes,
            startState = ToggleState.On,
            endState = ToggleState.Off
        )
        val routine = createRoutine(time, wm)

        val job = launch { routine.run(spec, sink) }

        // Should attempt to turn On despite read failure
        advanceTimeBy(1.seconds)
        assertEquals(ToggleState.On, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        job.cancel()
    }

    @Test
    fun `set off failure at end is logged but routine completes`() = actionTest {
        val time = TimeRepositoryMock()
        val wm = WorkflowManagerMock().apply { setAirConditionerState(ToggleState.Off) }
        val sink = RecordingRoutineStatusSink()
        val spec = AirConditionerRunForDurationRoutineSpec(
            runDuration = 1.minutes,
            startState = ToggleState.On,
            endState = ToggleState.Off
        )
        val routine = createRoutine(time, wm)

        val job = launch { routine.run(spec, sink) }

        // Turn on
        advanceTimeBy(1.seconds)
        assertEquals(ToggleState.On, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        // Set up failure for the OFF command
        wm.nextSetAirConditionerResult = TaskResult.Failed("AC control failed")

        // Advance to end - should attempt to turn off and fail
        advanceByWithTimeUpdate(time, 1.minutes + 1.seconds)

        // Failure event recorded for end_off stage
        assertTrue(sink.stages.any { it.type == "failure" && it.id == "end_off" })

        job.cancel()
    }

    @Test
    fun `skip redundant on false sends command even when already on`() = actionTest {
        val time = TimeRepositoryMock()
        val wm = WorkflowManagerMock().apply { setAirConditionerState(ToggleState.On) }
        val sink = RecordingRoutineStatusSink()
        val spec = AirConditionerRunForDurationRoutineSpec(
            runDuration = 1.minutes,
            startState = ToggleState.On,
            endState = ToggleState.Off,
            skipRedundantStart = false
        )
        val routine = createRoutine(time, wm)

        val job = launch { routine.run(spec, sink) }

        // Should send command even though already On
        advanceTimeBy(1.seconds)
        assertEquals(ToggleState.On, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        // Should have logged the transition
        assertTrue(sink.logs.any { it.message == "state_transition" && it.data["reason"] == "run_start" })

        job.cancel()
    }

    @Test
    fun `turns off then on after duration`() = actionTest {
        val time = TimeRepositoryMock()
        val wm = WorkflowManagerMock().apply { setAirConditionerState(ToggleState.On) }
        val sink = RecordingRoutineStatusSink()
        val spec = AirConditionerRunForDurationRoutineSpec(
            runDuration = 1.minutes,
            startState = ToggleState.Off,
            endState = ToggleState.On
        )
        val routine = createRoutine(time, wm)

        val job = launch { routine.run(spec, sink) }

        // Should turn off immediately
        advanceTimeBy(1.seconds)
        assertEquals(ToggleState.Off, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        // Jump to end - should turn on
        advanceByWithTimeUpdate(time, 1.minutes + 1.seconds)

        assertEquals(ToggleState.On, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)
        assertTrue(sink.logs.any { it.message == "state_transition" && it.data["reason"] == "run_complete" })

        job.cancel()
    }

    @Test
    fun `maintains off state for duration then turns on`() = actionTest {
        val time = TimeRepositoryMock()
        val wm = WorkflowManagerMock().apply { setAirConditionerState(ToggleState.Off) }
        val sink = RecordingRoutineStatusSink()
        val spec = AirConditionerRunForDurationRoutineSpec(
            runDuration = 1.minutes,
            startState = ToggleState.Off,
            endState = ToggleState.On
        )
        val routine = createRoutine(time, wm)

        val job = launch { routine.run(spec, sink) }

        // Should stay off (already in desired start state)
        advanceTimeBy(1.seconds)
        assertEquals(ToggleState.Off, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        // Jump to end - should turn on
        advanceByWithTimeUpdate(time, 1.minutes + 1.seconds)

        assertEquals(ToggleState.On, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        job.cancel()
    }

    @Test
    fun `turns on after waiting duration from off state`() = actionTest {
        val time = TimeRepositoryMock()
        val wm = WorkflowManagerMock().apply { setAirConditionerState(ToggleState.Off) }
        val sink = RecordingRoutineStatusSink()
        val spec = AirConditionerRunForDurationRoutineSpec(
            runDuration = 30.seconds,
            startState = ToggleState.Off,
            endState = ToggleState.On
        )
        val routine = createRoutine(time, wm)

        val job = launch { routine.run(spec, sink) }

        // Should stay OFF for the first part of the duration
        advanceTimeBy(10.seconds)
        assertEquals(ToggleState.Off, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        // Should still be OFF halfway through
        advanceTimeBy(10.seconds)
        assertEquals(ToggleState.Off, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)

        // Jump to end - should turn ON
        advanceByWithTimeUpdate(time, 10.seconds + 1.seconds)

        assertEquals(ToggleState.On, wm.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull)
        assertTrue(sink.logs.any { it.message == "state_transition" && it.data["reason"] == "run_complete" })

        job.cancel()
    }
}
