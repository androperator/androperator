package androperator.routine.temperature

import action.unit.Temperature
import androperator.routine.RoutineScheduleSpec
import androperator.routine.RoutineSpec
import kotlin.time.Duration
import kotlin.time.Duration.Companion.minutes

/**
 * Hysteresis spec for cooling:
 * - Turn ON when ambient >= onAtOrAbove.
 * - Turn OFF when ambient <= offAtOrBelow for at least belowOffThresholdRequired continuously.
 * - Otherwise, do nothing (neutral band).
 */
data class TemperatureRegulatorCoolRoutineSpec(
    val onAtOrAbove: Temperature = Temperature.TemperatureC(24.5f),
    val offAtOrBelow: Temperature = Temperature.TemperatureC(23.5f),
    val belowOffThresholdRequired: Duration = 10.minutes,
    val pollInterval: Duration = 5.minutes,
    val schedule: RoutineScheduleSpec? = null
) : RoutineSpec
