package androperator.routine

import kotlinx.datetime.DayOfWeek
import kotlinx.datetime.LocalTime

/**
 * Active between [startInclusive, endExclusive) on given days.
 * If endExclusive < startInclusive => spans midnight.
 * If endExclusive == startInclusive, the window is considered 24h for the selected days.
 * (Implementation detail: endExclusive <= startInclusive is treated as midnight-spanning; equal times
 * satisfy `time >= start || time < end`, which is always true.)
 */
data class RoutineTimeSpec(
    val startInclusive: LocalTime,
    val endExclusive: LocalTime,
    val daysOfWeek: Set<DayOfWeek> = DayOfWeek.entries.toSet()
)
