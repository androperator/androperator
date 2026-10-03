package androperator.routine.temperature

import action.time.TimeRepository
import androperator.routine.Routine
import androperator.routine.RoutineScheduleArbitrator
import androperator.routine.RoutineSpec
import androperator.routine.RoutineStatusSink
import androperator.routine.RoutineStatusSinkAdapter
import androperator.task.runner.isSuccess
import androperator.task.runner.valueOrNull
import androperator.uitree.ToggleState
import androperator.workflow.WorkflowManager
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlin.coroutines.coroutineContext
import kotlin.time.Duration.Companion.milliseconds

/**
 * Temperature regulator that controls an air conditioner with hysteresis.
 *
 * When reads fail, the OFF window timing uses wall-clock and is not reset.
 * This ensures continuous below-threshold time is properly tracked even across
 * temporary read failures.
 */
class TemperatureRegulatorCoolRoutine(
    private val timeRepository: TimeRepository,
    private val workflowManager: WorkflowManager,
) : Routine {

    private object StageId {
        const val SCHEDULE_CHECK = "schedule_check"
        const val READ_ENVIRONMENT = "read_environment"
        const val AIR_CONDITIONER_ON = "air_conditioner_on"
        const val AIR_CONDITIONER_OFF = "air_conditioner_off"
    }

    override suspend fun run(
        routineSpec: RoutineSpec,
        routineStatusSink: RoutineStatusSink,
    ) {
        require(routineSpec is TemperatureRegulatorCoolRoutineSpec) {
            "Expected TemperatureRegulatorCoolRoutineSpec, got ${routineSpec::class.simpleName}"
        }
        run(routineSpec = routineSpec, routineStatusSink = routineStatusSink)
    }

    suspend fun run(
        routineSpec: TemperatureRegulatorCoolRoutineSpec,
        routineStatusSink: RoutineStatusSink,
    ) {
        val taskStatusSink = RoutineStatusSinkAdapter(routineStatusSink)
        var belowOffThresholdStartEpochMs: Long? = null

        while (coroutineContext.isActive) {
            // Check schedule if configured
            val shouldSkipLoop = routineSpec.schedule?.let { schedule ->
                routineStatusSink.stageStart(StageId.SCHEDULE_CHECK, "Checking if routine should be active")

                val now = Instant.fromEpochMilliseconds(timeRepository.currentTime)
                val deviceZone = TimeZone.currentSystemDefault()

                val isActive = RoutineScheduleArbitrator.isActiveNow(schedule, now, deviceZone)

                if (!isActive) {
                    // Reset hysteresis timer while inactive
                    belowOffThresholdStartEpochMs = null

                    // Calculate next transition
                    val nextTransition = RoutineScheduleArbitrator.nextTransitionAfter(schedule, now, deviceZone)
                    val delayMs = nextTransition?.let { transition ->
                        val delayMillis = (transition - now).inWholeMilliseconds
                        maxOf(0L, delayMillis)
                    } ?: routineSpec.pollInterval.inWholeMilliseconds

                    routineStatusSink.log(
                        message = "schedule_inactive",
                        data = mapOf(
                            "sleep_ms" to delayMs.toString(),
                            "next_transition_epoch_ms" to nextTransition?.toEpochMilliseconds()?.toString().orEmpty()
                        )
                    )

                    routineStatusSink.stageSuccess(StageId.SCHEDULE_CHECK)
                    delay(delayMs.milliseconds)
                    true // Skip the rest of the loop
                } else {
                    routineStatusSink.stageSuccess(StageId.SCHEDULE_CHECK)
                    false // Continue with normal execution
                }
            } ?: false

            if (shouldSkipLoop) {
                continue
            }

            routineStatusSink.stageStart(StageId.READ_ENVIRONMENT, "Reading temperature and AC state")

            val temperatureResult = workflowManager.getAmbientTemperature(taskStatusSink)
            val toggleStateResult = workflowManager.getAirConditionerStatus(taskStatusSink)

            val temperature = temperatureResult.valueOrNull
            val toggleState = toggleStateResult.valueOrNull

            if (temperature == null || toggleState == null) {
                routineStatusSink.stageFailure(StageId.READ_ENVIRONMENT, "Failed to read temperature or AC state")
                delay(routineSpec.pollInterval)
                continue
            }

            routineStatusSink.log(
                "Read values",
                mapOf(
                    "temperature_celsius" to "%.1f".format(temperature.celsius),
                    "toggle_state" to toggleState.name
                )
            )

            val nowMs = timeRepository.currentTime

            when {
                // Turn ON if above threshold
                temperature.celsius >= routineSpec.onAtOrAbove.celsius -> {
                    belowOffThresholdStartEpochMs = null
                    if (toggleState != ToggleState.On) {
                        routineStatusSink.stageStart(StageId.AIR_CONDITIONER_ON, "Turning air conditioner ON")
                        val result = workflowManager.setAirConditionerStatus(ToggleState.On, taskStatusSink)
                        if (result.isSuccess) {
                            routineStatusSink.stageSuccess(StageId.AIR_CONDITIONER_ON)
                            routineStatusSink.log(
                                message = "state_transition",
                                data = mapOf(
                                    "transition" to "air_conditioner_on",
                                    "temperature_celsius" to "%.1f".format(temperature.celsius),
                                    "previous_state" to toggleState.name,
                                    "new_state" to ToggleState.On.name,
                                    "reason" to "above_on_threshold",
                                    "below_duration_ms" to "0",
                                    "timestamp_ms" to timeRepository.currentTime.toString()
                                )
                            )
                        } else routineStatusSink.stageFailure(StageId.AIR_CONDITIONER_ON, "Failed to turn AC ON")
                    }
                }

                // Turn OFF if below threshold for continuous window
                temperature.celsius <= routineSpec.offAtOrBelow.celsius -> {
                    if (belowOffThresholdStartEpochMs == null) {
                        belowOffThresholdStartEpochMs = nowMs
                    }
                    val belowDurationMs = nowMs - (belowOffThresholdStartEpochMs ?: nowMs)
                    if (belowDurationMs >= routineSpec.belowOffThresholdRequired.inWholeMilliseconds &&
                        toggleState != ToggleState.Off
                    ) {
                        routineStatusSink.stageStart(StageId.AIR_CONDITIONER_OFF, "Turning air conditioner OFF")
                        val result = workflowManager.setAirConditionerStatus(ToggleState.Off, taskStatusSink)
                        if (result.isSuccess) {
                            routineStatusSink.stageSuccess(StageId.AIR_CONDITIONER_OFF)
                            routineStatusSink.log(
                                message = "state_transition",
                                data = mapOf(
                                    "transition" to "air_conditioner_off",
                                    "temperature_celsius" to "%.1f".format(temperature.celsius),
                                    "previous_state" to toggleState.name,
                                    "new_state" to ToggleState.Off.name,
                                    "reason" to "below_off_threshold_window",
                                    "below_duration_ms" to belowDurationMs.toString(),
                                    "timestamp_ms" to timeRepository.currentTime.toString()
                                )
                            )
                        } else routineStatusSink.stageFailure(StageId.AIR_CONDITIONER_OFF, "Failed to turn AC OFF")
                    }
                }

                // Neutral band: reset timer
                else -> belowOffThresholdStartEpochMs = null
            }

            routineStatusSink.stageSuccess(StageId.READ_ENVIRONMENT)
            delay(routineSpec.pollInterval)
        }
    }
}
