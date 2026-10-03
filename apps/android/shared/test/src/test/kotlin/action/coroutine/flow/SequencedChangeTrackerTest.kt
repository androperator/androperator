package action.coroutine.flow

import app.cash.turbine.test
import androperator.test.actionTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.time.Duration.Companion.seconds

class SequencedChangeTrackerTest {
    @Test
    fun `emitting a change should be received in flow`() =
        actionTest {
            val tracker = SequencedChangeTracker<String>()

            tracker.flow.test(timeout = 5.seconds) {
                tracker.emit("test")
                assertEquals("test", awaitItem())
                expectNoEvents()
            }
        }

    @Test
    fun `changes should be received in order of emission`() =
        actionTest {
            val tracker = SequencedChangeTracker<Int>()
            val changes = listOf(1, 2, 3, 4, 5)

            // Use turbine to test the flow
            tracker.flow.test(timeout = 5.seconds) {
                // Emit values
                changes.forEach { tracker.emit(it) }

                // Verify each value is received in order
                changes.forEach { expectedValue ->
                    assertEquals(expectedValue, awaitItem())
                }

                // Ensure no more items are emitted
                expectNoEvents()
            }
        }

    @Test
    fun `null changes should be filtered out`() =
        actionTest {
            val tracker = SequencedChangeTracker<String?>()

            // Use turbine to test the flow
            tracker.flow.test(timeout = 5.seconds) {
                // Emit values
                tracker.emit(null)
                tracker.emit("test")
                tracker.emit(null)
                tracker.emit("final")

                // Verify only non-null values are received in order
                assertEquals("test", awaitItem())
                assertEquals("final", awaitItem())

                // Ensure no more items are emitted
                expectNoEvents()
            }
        }

    @Test
    fun `sequence numbers should increment monotonically`() =
        actionTest {
            val tracker = SequencedChangeTracker<String>()

            repeat(100) {
                tracker.emit("test$it")
            }

            // Verify last sequence number is 100
            val field = SequencedChangeTracker::class.java.getDeclaredField("sequenceNumber")
            field.isAccessible = true
            val sequenceNumber = field.get(tracker)
            assertNotNull(sequenceNumber)
            assertEquals(100L, sequenceNumber.toString().toLong())
        }
}
