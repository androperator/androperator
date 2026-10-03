package androperator.routine


import kotlinx.datetime.DatePeriod
import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.minus
import kotlinx.datetime.plus
import kotlinx.datetime.toInstant
import kotlinx.datetime.toLocalDateTime

object RoutineScheduleArbitrator {
    fun isActiveNow(
        schedule: RoutineScheduleSpec,
        instant: Instant,
        deviceZone: TimeZone
    ): Boolean {
        val zone = schedule.timeZone ?: deviceZone
        val localDateTime = instant.toLocalDateTime(zone)
        val currentTime = localDateTime.time
        val currentDay = localDateTime.dayOfWeek

        return schedule.windows.any { window ->
            val isCurrentDayMatch = window.daysOfWeek.contains(currentDay)
            val isTimeMatch = isTimeInWindow(currentTime, window)

            // For midnight-spanning windows, also check if the previous day matches
            val isPreviousDayMatch = if (window.isMidnightSpanning()) {
                val previousDay = localDateTime.date.minus(DatePeriod(days = 1)).dayOfWeek
                window.daysOfWeek.contains(previousDay)
            } else {
                false
            }

            (isCurrentDayMatch || isPreviousDayMatch) && isTimeMatch
        }
    }

    private data class Boundary(val instant: Instant, val delta: Int) // +1 start, -1 end

    /** Returns the next instant the active state flips (enter/exit). Null if none found. */
    // Note on DST: converting LocalDateTime boundaries via toInstant(zone) may hit DST gaps (nonexistent local times) or overlaps (ambiguous local times).
    // In the current implementation, if a LocalDateTime falls into a DST gap, toInstant(zone) will throw an exception.
    // If it falls into a DST overlap, toInstant(zone) will use the earlier of the two possible instants.
    // If a schedule needs strict or custom DST handling, consider resolving via zone transitions or constructing from atStartOfDayIn(zone) + durations.
    fun nextTransitionAfter(
        schedule: RoutineScheduleSpec,
        startInstant: Instant,
        deviceZone: TimeZone
    ): Instant? {
        val zone = schedule.timeZone ?: deviceZone
        val startActive = isActiveNow(schedule, startInstant, deviceZone)

        val boundaries = mutableListOf<Boundary>()
        val startLdt = startInstant.toLocalDateTime(zone)

        // We check 1 day before and 7 days after the start date (total 9 days) to ensure all possible
        // schedule windows are considered, including those that span midnight from the previous day.
        val DAYS_BEFORE = 1
        val DAYS_AFTER = 7
        for (days in -DAYS_BEFORE..DAYS_AFTER) {
            val date = startLdt.date.plus(DatePeriod(days = days))
            val dow = date.dayOfWeek
            for (w in schedule.windows) {
                if (w.daysOfWeek.contains(dow)) {
                    if (w.startInclusive < w.endExclusive) {
                        // Normal window
                        boundaries += Boundary(LocalDateTime(date, w.startInclusive).toInstant(zone), +1)
                        boundaries += Boundary(LocalDateTime(date, w.endExclusive).toInstant(zone), -1)
                    } else {
                        // Midnight-spanning window - start on this day
                        boundaries += Boundary(LocalDateTime(date, w.startInclusive).toInstant(zone), +1)
                    }
                }

                // For midnight-spanning windows, also check if we need to generate the end boundary
                // on this day (which would be the end of a window that started on the previous day)
                if (w.startInclusive >= w.endExclusive) {
                    val prevDate = date.minus(DatePeriod(days = 1))
                    val prevDow = prevDate.dayOfWeek
                    if (w.daysOfWeek.contains(prevDow)) {
                        // This date contains the end of a midnight-spanning window that started yesterday
                        boundaries += Boundary(LocalDateTime(date, w.endExclusive).toInstant(zone), -1)
                    }
                }
            }
        }

        // Only consider future boundaries and sort
        val future = boundaries.filter { it.instant > startInstant }.sortedBy { it.instant }
        if (future.isEmpty()) return null

        // Compute activeCount at startInstant by counting all boundaries <= startInstant
        var activeCount = 0
        val allBoundaries = boundaries.filter { it.instant <= startInstant }
        for (b in allBoundaries) {
            activeCount += b.delta
        }

        // Sweep for first flip
        for (b in future) {
            val wasActive = activeCount > 0
            activeCount += b.delta
            val nowActive = activeCount > 0
            if (wasActive != nowActive) return b.instant
        }
        return null
    }

    private fun isTimeInWindow(currentTime: kotlinx.datetime.LocalTime, window: RoutineTimeSpec): Boolean {
        val start = window.startInclusive
        val end = window.endExclusive

        return if (end > start) {
            // Normal window: start <= time < end
            currentTime >= start && currentTime < end
        } else {
            // Midnight-spanning window: time >= start || time < end
            currentTime >= start || currentTime < end
        }
    }

    private fun RoutineTimeSpec.isMidnightSpanning(): Boolean {
        return endExclusive <= startInclusive
    }
}
