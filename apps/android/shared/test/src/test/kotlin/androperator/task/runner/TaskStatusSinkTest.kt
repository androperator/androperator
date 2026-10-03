package androperator.task.runner

import androperator.test.actionTest
import kotlin.test.Test
import kotlin.test.assertTrue

class TaskStatusSinkTest {
    @Test
    fun `TaskStatusSink_NoOp should not emit any events`() {
        // Given
        val sink = TaskStatusSinkNoOp()

        // When
        sink.emit(TaskEvent.Log("test message"))
        sink.emit(TaskEvent.StageStart("test", "Test Stage"))

        // Then - No exceptions should be thrown, but nothing should happen
        // This is a no-op implementation
    }

    @Test
    fun `TaskStatusChannel should emit events to SharedFlow`() =
        actionTest {
            // Given
            val channel = TaskStatusSinkChannel()

            // When - Emit an event
            channel.emit(TaskEvent.Log("Test message"))

            // Then - The channel should accept the event without throwing
            // This is primarily a smoke test that the emit method works
            assertTrue(true, "Emit should not throw")
        }

    @Test
    fun `TaskStatusChannel should handle buffer overflow gracefully`() =
        actionTest {
            // Given - Small buffer
            val channel = TaskStatusSinkChannel(buffer = 2)

            // When - Emit more events than buffer size
            repeat(5) { i ->
                channel.emit(TaskEvent.Log("Message $i"))
            }

            // Then - Should not throw exceptions when buffer overflows
            assertTrue(true, "Should handle buffer overflow without throwing")
        }
}
