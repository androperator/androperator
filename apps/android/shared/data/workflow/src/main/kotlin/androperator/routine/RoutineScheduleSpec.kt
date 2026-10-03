package androperator.routine

import kotlinx.datetime.TimeZone

data class RoutineScheduleSpec(
    val windows: List<RoutineTimeSpec>,
    /** If null, use device default zone. */
    val timeZone: TimeZone? = null
)
