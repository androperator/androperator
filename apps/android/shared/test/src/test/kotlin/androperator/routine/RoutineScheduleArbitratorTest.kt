package androperator.routine

import kotlinx.datetime.DayOfWeek
import kotlinx.datetime.LocalDateTime
import kotlinx.datetime.LocalTime
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toInstant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RoutineScheduleArbitratorTest {

    private val utc = TimeZone.UTC

    @Test
    fun `isActiveNow returns true inside normal window same day`() {
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(9, 0),
                    endExclusive = LocalTime(17, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                )
            )
        )

        // Monday 12:00 should be active
        val mondayNoon = LocalDateTime(2024, 1, 1, 12, 0).toInstant(utc) // Monday

        assertTrue(RoutineScheduleArbitrator.isActiveNow(schedule, mondayNoon, utc))
    }

    @Test
    fun `isActiveNow returns false outside window same day`() {
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(9, 0),
                    endExclusive = LocalTime(17, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                )
            )
        )

        // Monday 20:00 should be inactive
        val mondayEvening = LocalDateTime(2024, 1, 1, 20, 0).toInstant(utc) // Monday

        assertFalse(RoutineScheduleArbitrator.isActiveNow(schedule, mondayEvening, utc))
    }

    @Test
    fun `isActiveNow handles midnight span - early morning active`() {
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(21, 0),
                    endExclusive = LocalTime(1, 0), // Midnight spanning
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                )
            )
        )

        // Monday 23:00 should be active (after 21:00)
        val mondayEvening = LocalDateTime(2024, 1, 1, 23, 0).toInstant(utc) // Monday
        assertTrue(RoutineScheduleArbitrator.isActiveNow(schedule, mondayEvening, utc))

        // Tuesday 00:30 should be active (before 01:00)
        val tuesdayEarly = LocalDateTime(2024, 1, 2, 0, 30).toInstant(utc) // Tuesday
        assertTrue(RoutineScheduleArbitrator.isActiveNow(schedule, tuesdayEarly, utc))
    }

    @Test
    fun `isActiveNow handles midnight span - daytime inactive`() {
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(21, 0),
                    endExclusive = LocalTime(1, 0), // Midnight spanning
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                )
            )
        )

        // Tuesday 12:00 should be inactive
        val tuesdayNoon = LocalDateTime(2024, 1, 2, 12, 0).toInstant(utc) // Tuesday
        assertFalse(RoutineScheduleArbitrator.isActiveNow(schedule, tuesdayNoon, utc))
    }

    @Test
    fun `isActiveNow respects daysOfWeek - wrong day inactive`() {
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(9, 0),
                    endExclusive = LocalTime(17, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                )
            )
        )

        // Tuesday 12:00 should be inactive (wrong day)
        val tuesdayNoon = LocalDateTime(2024, 1, 2, 12, 0).toInstant(utc) // Tuesday
        assertFalse(RoutineScheduleArbitrator.isActiveNow(schedule, tuesdayNoon, utc))
    }

    @Test
    fun `isActiveNow respects daysOfWeek - correct day active`() {
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(9, 0),
                    endExclusive = LocalTime(17, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY, DayOfWeek.TUESDAY)
                )
            )
        )

        // Tuesday 12:00 should be active (correct day)
        val tuesdayNoon = LocalDateTime(2024, 1, 2, 12, 0).toInstant(utc) // Tuesday
        assertTrue(RoutineScheduleArbitrator.isActiveNow(schedule, tuesdayNoon, utc))
    }

    @Test
    fun `nextTransitionAfter returns next start when currently outside`() {
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(9, 0),
                    endExclusive = LocalTime(17, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                )
            )
        )

        // Monday 8:00 - before window starts
        val mondayEarly = LocalDateTime(2024, 1, 1, 8, 0).toInstant(utc) // Monday
        val nextTransition = RoutineScheduleArbitrator.nextTransitionAfter(schedule, mondayEarly, utc)

        val expectedStart = LocalDateTime(2024, 1, 1, 9, 0).toInstant(utc)
        assertEquals(expectedStart, nextTransition)
    }

    @Test
    fun `nextTransitionAfter returns next end when currently inside`() {
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(9, 0),
                    endExclusive = LocalTime(17, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                )
            )
        )

        // Monday 12:00 - inside window
        val mondayNoon = LocalDateTime(2024, 1, 1, 12, 0).toInstant(utc) // Monday
        val nextTransition = RoutineScheduleArbitrator.nextTransitionAfter(schedule, mondayNoon, utc)

        val expectedEnd = LocalDateTime(2024, 1, 1, 17, 0).toInstant(utc)
        assertEquals(expectedEnd, nextTransition)
    }

    @Test
    fun `nextTransitionAfter crosses week boundary`() {
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(9, 0),
                    endExclusive = LocalTime(17, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                )
            )
        )

        // Sunday 18:00 - after last Monday window
        val sundayEvening = LocalDateTime(2024, 1, 7, 18, 0).toInstant(utc) // Sunday
        val nextTransition = RoutineScheduleArbitrator.nextTransitionAfter(schedule, sundayEvening, utc)

        // Should be next Monday 9:00
        val expectedStart = LocalDateTime(2024, 1, 8, 9, 0).toInstant(utc) // Monday
        assertEquals(expectedStart, nextTransition)
    }

    @Test
    fun `nextTransitionAfter with multiple windows chooses earliest`() {
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(9, 0),
                    endExclusive = LocalTime(17, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                ),
                RoutineTimeSpec(
                    startInclusive = LocalTime(20, 0),
                    endExclusive = LocalTime(22, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                )
            )
        )

        // Monday 18:00 - between windows
        val mondayEvening = LocalDateTime(2024, 1, 1, 18, 0).toInstant(utc) // Monday
        val nextTransition = RoutineScheduleArbitrator.nextTransitionAfter(schedule, mondayEvening, utc)

        // Should be the earlier start time (20:00)
        val expectedStart = LocalDateTime(2024, 1, 1, 20, 0).toInstant(utc)
        assertEquals(expectedStart, nextTransition)
    }

    @Test
    fun `nextTransitionAfter handles midnight spanning window`() {
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(21, 0),
                    endExclusive = LocalTime(1, 0), // Midnight spanning
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                )
            )
        )

        // Monday 19:00 - before midnight-spanning window
        val mondayEvening = LocalDateTime(2024, 1, 1, 19, 0).toInstant(utc) // Monday
        val nextTransition = RoutineScheduleArbitrator.nextTransitionAfter(schedule, mondayEvening, utc)

        // Should be Monday 21:00 start
        val expectedStart = LocalDateTime(2024, 1, 1, 21, 0).toInstant(utc)
        assertEquals(expectedStart, nextTransition)
    }

    @Test
    fun `nextTransitionAfter returns null when no windows defined`() {
        val schedule = RoutineScheduleSpec(windows = emptyList())

        val mondayNoon = LocalDateTime(2024, 1, 1, 12, 0).toInstant(utc)
        val nextTransition = RoutineScheduleArbitrator.nextTransitionAfter(schedule, mondayNoon, utc)

        assertNull(nextTransition)
    }

    @Test
    fun `isActiveNow with multiple windows - OR logic`() {
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(9, 0),
                    endExclusive = LocalTime(12, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                ),
                RoutineTimeSpec(
                    startInclusive = LocalTime(14, 0),
                    endExclusive = LocalTime(17, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                )
            )
        )

        // Monday 10:00 - in first window
        val mondayMorning = LocalDateTime(2024, 1, 1, 10, 0).toInstant(utc)
        assertTrue(RoutineScheduleArbitrator.isActiveNow(schedule, mondayMorning, utc))

        // Monday 15:00 - in second window
        val mondayAfternoon = LocalDateTime(2024, 1, 1, 15, 0).toInstant(utc)
        assertTrue(RoutineScheduleArbitrator.isActiveNow(schedule, mondayAfternoon, utc))

        // Monday 13:00 - between windows
        val mondayLunch = LocalDateTime(2024, 1, 1, 13, 0).toInstant(utc)
        assertFalse(RoutineScheduleArbitrator.isActiveNow(schedule, mondayLunch, utc))
    }

    @Test
    fun `nextTransitionAfter for midnight span returns next-day end when inside after midnight`() {
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(21, 0),
                    endExclusive = LocalTime(1, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                )
            )
        )

        // Tuesday 00:30 - inside midnight-spanning window that started Monday
        val tuesdayMidnight = LocalDateTime(2024, 1, 2, 0, 30).toInstant(utc) // Tuesday
        val nextTransition = RoutineScheduleArbitrator.nextTransitionAfter(schedule, tuesdayMidnight, utc)

        // Should be Tuesday 01:00 end
        val expectedEnd = LocalDateTime(2024, 1, 2, 1, 0).toInstant(utc)
        assertEquals(expectedEnd, nextTransition)
    }

    @Test
    fun `nextTransitionAfter ignores non-flipping starts when already active (overlap)`() {
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(9, 0),
                    endExclusive = LocalTime(17, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                ),
                RoutineTimeSpec(
                    startInclusive = LocalTime(14, 0),
                    endExclusive = LocalTime(18, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                )
            )
        )

        // Monday 13:00 - inside first window, next should be 18:00 end (union ends)
        val mondayEarly = LocalDateTime(2024, 1, 1, 13, 0).toInstant(utc)
        val nextTransition = RoutineScheduleArbitrator.nextTransitionAfter(schedule, mondayEarly, utc)
        val expectedEnd = LocalDateTime(2024, 1, 1, 18, 0).toInstant(utc)
        assertEquals(expectedEnd, nextTransition)
    }

    @Test
    fun `nextTransitionAfter chooses union-end when overlapping windows extend activity`() {
        val schedule = RoutineScheduleSpec(
            windows = listOf(
                RoutineTimeSpec(
                    startInclusive = LocalTime(9, 0),
                    endExclusive = LocalTime(17, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                ),
                RoutineTimeSpec(
                    startInclusive = LocalTime(14, 0),
                    endExclusive = LocalTime(18, 0),
                    daysOfWeek = setOf(DayOfWeek.MONDAY)
                )
            )
        )

        // Monday 16:30 - inside overlap (both windows active), next should be 18:00 end (union end)
        val mondayOverlap = LocalDateTime(2024, 1, 1, 16, 30).toInstant(utc)
        val nextTransition = RoutineScheduleArbitrator.nextTransitionAfter(schedule, mondayOverlap, utc)
        val expectedEnd = LocalDateTime(2024, 1, 1, 18, 0).toInstant(utc)
        assertEquals(expectedEnd, nextTransition)
    }
}
