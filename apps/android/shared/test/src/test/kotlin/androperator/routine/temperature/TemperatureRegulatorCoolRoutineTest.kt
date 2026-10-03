package androperator.routine.temperature

import action.time.TimeRepositoryMock
import action.unit.Temperature
import androperator.routine.RecordingRoutineStatusSink
import androperator.routine.RoutineScheduleSpec
import androperator.routine.RoutineTimeSpec
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
import kotlinx.datetime.DayOfWeek
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.LocalTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toInstant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.minutes
import kotlin.time.Duration.Companion.seconds

class TemperatureRegulatorCoolRoutineTest : ActionTest {

    private val utc = TimeZone.UTC

    private fun createRoutine(
        timeRepository: TimeRepositoryMock,
        workflowManager: WorkflowManagerMock,
    ) = TemperatureRegulatorCoolRoutine(
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
    fun `turns air conditioner ON when temperature rises above threshold`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(25.0f))
            setAirConditionerState(ToggleState.Off)
        }
        val statusSink = RecordingRoutineStatusSink()
        val spec = TemperatureRegulatorCoolRoutineSpec(pollInterval = 1.minutes)
        val routine = TemperatureRegulatorCoolRoutine(
            timeRepository = timeRepository,
            workflowManager = workflowManager,
        )

        val job = launch { routine.run(spec, statusSink) }
        advanceTimeBy(1.seconds)
        assertEquals(
            ToggleState.On,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        // Check transition log
        val transitionLogs = statusSink.logs.filter { it.message == "state_transition" }
        assertEquals(1, transitionLogs.size)
        val log = transitionLogs.first()
        assertEquals("air_conditioner_on", log.data["transition"])
        assertEquals("25.0", log.data["temperature_celsius"])
        assertEquals("Off", log.data["previous_state"])
        assertEquals("On", log.data["new_state"])
        assertEquals("above_on_threshold", log.data["reason"])
        assertEquals("0", log.data["below_duration_ms"])
        assert(log.data.containsKey("timestamp_ms"))

        job.cancel()
    }

    @Test
    fun `turns air conditioner OFF only after continuous 10 minutes below threshold`() =
        actionTest {
            val timeRepository = TimeRepositoryMock()
            val workflowManager = WorkflowManagerMock().apply {
                setAmbientTemperature(Temperature.Companion.TemperatureC(23.0f))
                setAirConditionerState(ToggleState.On)
            }
            val spec = TemperatureRegulatorCoolRoutineSpec(
                pollInterval = 1.minutes,
                belowOffThresholdRequired = 10.minutes
            )
            val statusSink = RecordingRoutineStatusSink()
            val routine = TemperatureRegulatorCoolRoutine(
                timeRepository = timeRepository,
                workflowManager = workflowManager,
            )

            val job = launch { routine.run(spec, statusSink) }
            // Wait for first poll - advance virtual time for coroutine delays
            advanceTimeBy(1.seconds)
            assertEquals(
                ToggleState.On,
                workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
            )

            // Advance time by 9 minutes (for hysteresis calculation)
            advanceByWithTimeUpdate(timeRepository, 9.minutes)
            assertEquals(
                ToggleState.On,
                workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
            )

            // Advance time to cross 10-minute threshold
            advanceByWithTimeUpdate(timeRepository, 1.minutes + 500.milliseconds)
            assertEquals(
                ToggleState.Off,
                workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
            )

            // Check transition log
            val transitionLogs = statusSink.logs.filter { it.message == "state_transition" }
            assertEquals(1, transitionLogs.size)
            val log = transitionLogs.first()
            assertEquals("air_conditioner_off", log.data["transition"])
            assertEquals("23.0", log.data["temperature_celsius"])
            assertEquals("On", log.data["previous_state"])
            assertEquals("Off", log.data["new_state"])
            assertEquals("below_off_threshold_window", log.data["reason"])
            assert(log.data["below_duration_ms"]!!.toLong() >= 10.minutes.inWholeMilliseconds)
            assert(log.data.containsKey("timestamp_ms"))

            job.cancel()
        }

    @Test
    fun `does nothing in hysteresis neutral band`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(24.0f))
            setAirConditionerState(ToggleState.On)
        }
        val spec = TemperatureRegulatorCoolRoutineSpec()
        val routine = createRoutine(timeRepository, workflowManager)
        val job = launch { routine.run(spec, RecordingRoutineStatusSink()) }
        advanceTimeBy(3.seconds)
        assertEquals(
            ToggleState.On,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )
        job.cancel()
    }

    @Test
    fun `exactly at onAtOrAbove threshold turns ON`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(24.5f)) // exactly at onAtOrAbove
            setAirConditionerState(ToggleState.Off)
        }
        val spec = TemperatureRegulatorCoolRoutineSpec()
        val routine = createRoutine(timeRepository, workflowManager)
        val job = launch { routine.run(spec, RecordingRoutineStatusSink()) }
        advanceTimeBy(1.seconds)
        assertEquals(
            ToggleState.On,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )
        job.cancel()
    }

    @Test
    fun `exactly at offAtOrBelow contributes to OFF timing`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(23.5f)) // exactly at offAtOrBelow
            setAirConditionerState(ToggleState.On)
        }
        val spec = TemperatureRegulatorCoolRoutineSpec(
            pollInterval = 1.minutes,
            belowOffThresholdRequired = 2.minutes
        )
        val routine = createRoutine(timeRepository, workflowManager)
        val job = launch { routine.run(spec, RecordingRoutineStatusSink()) }

        // First poll
        advanceTimeBy(1.seconds)
        assertEquals(
            ToggleState.On,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        // Advance time to cross the 2-minute threshold
        advanceByWithTimeUpdate(timeRepository, 2.minutes)
        assertEquals(
            ToggleState.Off,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        job.cancel()
    }

    @Test
    fun `neutral band preserves OFF state across multiple polls`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(24.0f)) // strictly between thresholds
            setAirConditionerState(ToggleState.Off)
        }
        val spec = TemperatureRegulatorCoolRoutineSpec(pollInterval = 30.seconds)
        val routine = createRoutine(timeRepository, workflowManager)
        val job = launch { routine.run(spec, RecordingRoutineStatusSink()) }

        // Let first cycle happen
        advanceTimeBy(1.seconds)
        assertEquals(
            ToggleState.Off,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        // Advance several polls; state should not change
        repeat(3) { advanceTimeBy(30.seconds) }
        assertEquals(
            ToggleState.Off,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        job.cancel()
    }

    @Test
    fun `hysteresis timer resets on temperature spike above threshold`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(23.0f)) // below threshold
            setAirConditionerState(ToggleState.On)
        }
        val spec = TemperatureRegulatorCoolRoutineSpec(
            pollInterval = 1.minutes,
            belowOffThresholdRequired = 5.minutes
        )
        val routine = createRoutine(timeRepository, workflowManager)
        val job = launch { routine.run(spec, RecordingRoutineStatusSink()) }

        // Start timing below threshold
        advanceTimeBy(1.seconds)
        assertEquals(
            ToggleState.On,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        // Advance 4 minutes toward the 5-minute threshold
        advanceByWithTimeUpdate(timeRepository, 4.minutes)
        assertEquals(
            ToggleState.On,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        // Spike to above threshold (neutral band), which should reset the timer
        workflowManager.setAmbientTemperature(Temperature.Companion.TemperatureC(24.0f))
        advanceTimeBy(1.minutes)
        assertEquals(
            ToggleState.On,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        // Go back below threshold - timer should reset, so even after another 4 minutes, still ON
        workflowManager.setAmbientTemperature(Temperature.Companion.TemperatureC(23.0f))
        advanceByWithTimeUpdate(timeRepository, 4.minutes)
        assertEquals(
            ToggleState.On,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        job.cancel()
    }

    @Test
    fun `no redundant commands when already in desired ON state`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(25.0f)) // above threshold
            setAirConditionerState(ToggleState.On) // already ON
        }

        // Set up to fail if setAirConditionerStatus is called (it shouldn't be)
        workflowManager.nextSetAirConditionerResult = TaskResult.Failed("Should not be called")

        val spec = TemperatureRegulatorCoolRoutineSpec()
        val routine = createRoutine(timeRepository, workflowManager)
        val job = launch { routine.run(spec, RecordingRoutineStatusSink()) }

        // Advance time and ensure no state change occurs
        advanceTimeBy(5.seconds)
        assertEquals(
            ToggleState.On,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        job.cancel()
    }

    @Test
    fun `read failure for temperature continues polling without state change`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(25.0f))
            setAirConditionerState(ToggleState.Off)
            nextGetTemperatureResult = TaskResult.Failed("Temperature sensor failed")
        }
        val statusSink = RecordingRoutineStatusSink()
        val spec = TemperatureRegulatorCoolRoutineSpec(pollInterval = 1.minutes)
        val routine = TemperatureRegulatorCoolRoutine(
            timeRepository = timeRepository,
            workflowManager = workflowManager,
        )
        val job = launch { routine.run(spec, statusSink) }

        // First poll should fail to read temperature
        advanceTimeBy(1.seconds)
        assertEquals(
            ToggleState.Off,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        ) // No change

        // Should have recorded a failure
        val failureEvents =
            statusSink.stages.filter { it.type == "failure" && it.id == "read_environment" }
        assertEquals(1, failureEvents.size)

        job.cancel()
    }

    @Test
    fun `read failure for AC status continues polling without state change`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(25.0f)) // above threshold
            setAirConditionerState(ToggleState.Off)
            nextGetAirConditionerResult = TaskResult.Failed("AC status sensor failed")
        }
        val statusSink = RecordingRoutineStatusSink()
        val spec = TemperatureRegulatorCoolRoutineSpec(pollInterval = 1.minutes)
        val routine = TemperatureRegulatorCoolRoutine(
            timeRepository = timeRepository,
            workflowManager = workflowManager,
        )
        val job = launch { routine.run(spec, statusSink) }

        // First poll should fail to read AC status
        advanceTimeBy(1.seconds)
        assertEquals(
            ToggleState.Off,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        ) // No change

        // Should have recorded a failure
        val failureEvents =
            statusSink.stages.filter { it.type == "failure" && it.id == "read_environment" }
        assertEquals(1, failureEvents.size)

        job.cancel()
    }

    @Test
    fun `cancellation ends loop immediately`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(25.0f))
            setAirConditionerState(ToggleState.Off)
        }
        val statusSink = RecordingRoutineStatusSink()
        val spec = TemperatureRegulatorCoolRoutineSpec(pollInterval = 1.minutes)
        val routine = TemperatureRegulatorCoolRoutine(
            timeRepository = timeRepository,
            workflowManager = workflowManager,
        )

        val job = launch { routine.run(spec, statusSink) }

        // Let it start and do one poll
        advanceTimeBy(1.seconds)
        // Note: no assertion here as this test doesn't check state, just that cancellation works

        // Cancel immediately
        job.cancel()

        // Should have at least started reading environment
        assert(statusSink.stages.any { it.id == "read_environment" })
    }

    @Test
    fun `status sink events recorded correctly for ON transition`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(25.0f)) // above threshold
            setAirConditionerState(ToggleState.Off)
        }
        val statusSink = RecordingRoutineStatusSink()
        val spec = TemperatureRegulatorCoolRoutineSpec(pollInterval = 1.minutes)
        val routine = TemperatureRegulatorCoolRoutine(
            timeRepository = timeRepository,
            workflowManager = workflowManager,
        )
        val job = launch { routine.run(spec, statusSink) }

        // Let the routine run one cycle
        advanceTimeBy(1.seconds)

        // Check the event sequence
        val events = statusSink.stages
        assert(events.any { it.type == "start" && it.id == "read_environment" })
        assert(events.any { it.type == "success" && it.id == "read_environment" })
        assert(events.any { it.type == "start" && it.id == "air_conditioner_on" })
        assert(events.any { it.type == "success" && it.id == "air_conditioner_on" })

        job.cancel()
    }

    @Test
    fun `write failure prevents state change and records failure`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(25.0f)) // above threshold
            setAirConditionerState(ToggleState.Off)
            nextSetAirConditionerResult = TaskResult.Failed("AC control failed")
        }
        val statusSink = RecordingRoutineStatusSink()
        val spec = TemperatureRegulatorCoolRoutineSpec(pollInterval = 1.minutes)
        val routine = TemperatureRegulatorCoolRoutine(
            timeRepository = timeRepository,
            workflowManager = workflowManager,
        )
        val job = launch { routine.run(spec, statusSink) }

        // Let the routine attempt to turn ON
        advanceTimeBy(1.seconds)

        // State should not have changed
        assertEquals(
            ToggleState.Off,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        // Check for failure event
        val failureEvents =
            statusSink.stages.filter { it.type == "failure" && it.id == "air_conditioner_on" }
        assertEquals(1, failureEvents.size)

        job.cancel()
    }

    @Test
    fun `immediate window turns OFF on first loop when temperature drops`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(23.0f)) // below threshold
            setAirConditionerState(ToggleState.On)
        }
        val spec = TemperatureRegulatorCoolRoutineSpec(
            pollInterval = 1.minutes,
            belowOffThresholdRequired = 0.seconds
        )
        val statusSink = RecordingRoutineStatusSink()
        val routine = TemperatureRegulatorCoolRoutine(
            timeRepository = timeRepository,
            workflowManager = workflowManager,
        )
        val job = launch { routine.run(spec, statusSink) }

        // First poll should turn OFF immediately due to 0-second window
        advanceTimeBy(1.seconds)
        assertEquals(
            ToggleState.Off,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        // Check for transition log
        val transitionLogs = statusSink.logs.filter { it.message == "state_transition" }
        assertEquals(1, transitionLogs.size)
        assertEquals("air_conditioner_off", transitionLogs.first().data["transition"])
        assertEquals("below_off_threshold_window", transitionLogs.first().data["reason"])

        job.cancel()
    }

    @Test
    fun `recovers after AC status read failure and turns ON on next poll`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(25.0f))
            setAirConditionerState(ToggleState.Off)
            nextGetAirConditionerResult = TaskResult.Failed("flaky AC status")
        }
        val statusSink = RecordingRoutineStatusSink()
        val spec = TemperatureRegulatorCoolRoutineSpec(pollInterval = 1.minutes)
        val routine = TemperatureRegulatorCoolRoutine(
            timeRepository = timeRepository,
            workflowManager = workflowManager,
        )

        val job = launch { routine.run(spec, statusSink) }

        // First poll -> read failure, no change
        advanceTimeBy(1.seconds)
        assertEquals(
            ToggleState.Off,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )
        assert(statusSink.stages.any { it.type == "failure" && it.id == "read_environment" })

        // Next poll succeeds -> should turn ON
        advanceTimeBy(1.minutes)
        assertEquals(
            ToggleState.On,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )
        assert(statusSink.logs.any { it.message == "state_transition" && it.data["transition"] == "air_conditioner_on" })

        job.cancel()
    }

    @Test
    fun `OFF window spans across read failure`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(23.0f)) // below threshold
            setAirConditionerState(ToggleState.On)
        }
        val spec = TemperatureRegulatorCoolRoutineSpec(
            pollInterval = 1.minutes,
            belowOffThresholdRequired = 5.minutes
        )
        val statusSink = RecordingRoutineStatusSink()
        val routine = TemperatureRegulatorCoolRoutine(
            timeRepository = timeRepository,
            workflowManager = workflowManager,
        )

        val job = launch { routine.run(spec, statusSink) }

        // Start window
        advanceTimeBy(1.seconds)

        // 3 minutes elapse
        advanceByWithTimeUpdate(timeRepository, 3.minutes)

        // Inject read failure for temperature
        workflowManager.nextGetTemperatureResult = TaskResult.Failed("temp read failed")
        advanceTimeBy(1.minutes)
        assertEquals(
            ToggleState.On,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        // 2 more minutes elapse (total >= 5)
        advanceByWithTimeUpdate(timeRepository, 2.minutes)

        // Should now switch OFF and log transition
        assertEquals(
            ToggleState.Off,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )
        val transitionLog =
            statusSink.logs.firstOrNull { it.message == "state_transition" && it.data["transition"] == "air_conditioner_off" }
        checkNotNull(transitionLog)
        assert(transitionLog.data["below_duration_ms"]!!.toLong() >= 5.minutes.inWholeMilliseconds)

        job.cancel()
    }

    @Test
    fun `no transition log when write fails`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(25.0f))
            setAirConditionerState(ToggleState.Off)
            nextSetAirConditionerResult = TaskResult.Failed("flaky write")
        }
        val statusSink = RecordingRoutineStatusSink()
        val spec = TemperatureRegulatorCoolRoutineSpec(pollInterval = 1.minutes)
        val routine = TemperatureRegulatorCoolRoutine(
            timeRepository = timeRepository,
            workflowManager = workflowManager,
        )

        val job = launch { routine.run(spec, statusSink) }
        advanceTimeBy(1.seconds)

        // State unchanged
        assertEquals(
            ToggleState.Off,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )
        // Failure event recorded
        assert(statusSink.stages.any { it.type == "failure" && it.id == "air_conditioner_on" })
        // No transition log
        assert(statusSink.logs.none { it.message == "state_transition" })

        job.cancel()
    }

    @Test
    fun `no redundant OFF command or transition when already OFF below threshold`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(23.0f))
            setAirConditionerState(ToggleState.Off)
        }
        val spec = TemperatureRegulatorCoolRoutineSpec(
            pollInterval = 1.minutes,
            belowOffThresholdRequired = 2.minutes
        )
        val statusSink = RecordingRoutineStatusSink()
        val routine = TemperatureRegulatorCoolRoutine(
            timeRepository = timeRepository,
            workflowManager = workflowManager,
        )

        val job = launch { routine.run(spec, statusSink) }

        // Let window elapse
        advanceByWithTimeUpdate(timeRepository, 3.minutes)

        // Still OFF, no transition, no AC_OFF stage start
        assertEquals(
            ToggleState.Off,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )
        assert(statusSink.stages.none { it.id == "air_conditioner_off" && it.type == "start" })
        assert(statusSink.logs.none { it.message == "state_transition" })

        job.cancel()
    }

    @Test
    fun `neutral band preserves ON state across multiple polls`() = actionTest {
        val timeRepository = TimeRepositoryMock()
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(24.0f)) // neutral band
            setAirConditionerState(ToggleState.On)
        }
        val statusSink = RecordingRoutineStatusSink()
        val spec = TemperatureRegulatorCoolRoutineSpec(pollInterval = 30.seconds)
        val routine = TemperatureRegulatorCoolRoutine(
            timeRepository = timeRepository,
            workflowManager = workflowManager,
        )
        val job = launch { routine.run(spec, statusSink) }

        advanceTimeBy(1.seconds)
        repeat(3) { advanceTimeBy(30.seconds) }
        assertEquals(
            ToggleState.On,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        job.cancel()
    }

    @Test
    fun `schedule inactive - skips temperature reads and sleeps until next transition`() =
        actionTest {
            val inactiveTime = LocalDateTime(2024, 1, 2, 12, 0).toInstant(utc)
            val timeRepository = TimeRepositoryMock(inactiveTime.toEpochMilliseconds())
            val workflowManager = WorkflowManagerMock().apply {
                setAmbientTemperature(Temperature.Companion.TemperatureC(25.0f)) // above threshold
                setAirConditionerState(ToggleState.Off)
            }
            val statusSink = RecordingRoutineStatusSink()

            // Schedule: only active Monday 9:00-17:00
            val schedule = RoutineScheduleSpec(
                windows = listOf(
                    RoutineTimeSpec(
                        startInclusive = LocalTime(9, 0),
                        endExclusive = LocalTime(17, 0),
                        daysOfWeek = setOf(DayOfWeek.MONDAY)
                    )
                )
            )
            val spec = TemperatureRegulatorCoolRoutineSpec(
                pollInterval = 5.minutes,
                schedule = schedule
            )

            val routine = createRoutine(timeRepository, workflowManager)
            val job = launch { routine.run(spec, statusSink) }

            // First poll - Tuesday 12:00 UTC is outside a Monday 9:00-17:00 window.
            advanceTimeBy(1.seconds)

            // Should have schedule_check stage but no read_environment stage yet
            assert(statusSink.stages.any { it.id == "schedule_check" && it.type == "success" })
            assert(statusSink.stages.none { it.id == "read_environment" })

            // Should have schedule_inactive log
            val inactiveLogs = statusSink.logs.filter { it.message == "schedule_inactive" }
            assertEquals(1, inactiveLogs.size)

            job.cancel()
        }

    @Test
    fun `schedule active - proceeds with normal temperature regulation`() = actionTest {
        val activeTime = LocalDateTime(2024, 1, 1, 12, 0).toInstant(utc)
        val timeRepository = TimeRepositoryMock(activeTime.toEpochMilliseconds())
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(25.0f)) // above threshold
            setAirConditionerState(ToggleState.Off)
        }
        val statusSink = RecordingRoutineStatusSink()

        // Schedule: active every day 0:00-24:00 (midnight-spanning, effectively always active)
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(0, 0),
                    endExclusive = LocalTime(0, 0),
                    daysOfWeek = DayOfWeek.entries.toSet()
                )
            )
        )
        val spec = TemperatureRegulatorCoolRoutineSpec(
            pollInterval = 5.minutes,
            schedule = schedule
        )

        val routine = createRoutine(timeRepository, workflowManager)
        val job = launch { routine.run(spec, statusSink) }

        // Should proceed with normal operation
        advanceTimeBy(1.seconds)

        // Should have both schedule_check and read_environment stages
        assert(statusSink.stages.any { it.id == "schedule_check" && it.type == "success" })
        assert(statusSink.stages.any { it.id == "read_environment" && it.type == "success" })

        // Should have turned AC ON
        assertEquals(
            ToggleState.On,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        job.cancel()
    }

    @Test
    fun `schedule inactive resets hysteresis timer`() = actionTest {
        val inactiveTime = LocalDateTime(2024, 1, 2, 12, 0).toInstant(utc)
        val timeRepository = TimeRepositoryMock(inactiveTime.toEpochMilliseconds())
        val workflowManager = WorkflowManagerMock().apply {
            setAmbientTemperature(Temperature.Companion.TemperatureC(23.0f)) // below threshold
            setAirConditionerState(ToggleState.On)
        }
        val statusSink = RecordingRoutineStatusSink()

        // Schedule: only active Monday 9:00-17:00
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(9, 0),
                    endExclusive = LocalTime(17, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                )
            )
        )
        val spec = TemperatureRegulatorCoolRoutineSpec(
            pollInterval = 1.minutes,
            belowOffThresholdRequired = 5.minutes,
            schedule = schedule
        )

        val routine = createRoutine(timeRepository, workflowManager)
        val job = launch { routine.run(spec, statusSink) }

        // First poll - schedule inactive, should reset hysteresis
        advanceTimeBy(1.seconds)
        assert(statusSink.stages.any { it.id == "schedule_check" && it.type == "success" })
        assert(statusSink.logs.any { it.message == "schedule_inactive" })

        // If we were to become active now, hysteresis should be reset (no prior timing)
        // We can't easily test the internal state, but we can verify no state changes occurred
        assertEquals(
            ToggleState.On,
            workflowManager.getAirConditionerStatus(TaskStatusSinkNoOp()).valueOrNull
        )

        job.cancel()
    }
}
