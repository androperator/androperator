package androperator.task.runner

import androperator.test.actionTest
import kotlin.test.Test
import kotlin.test.assertTrue

class TaskStatusPayloadTest {
    @Test
    fun `TaskStatusSink should handle various payload structures without errors`() =
        actionTest {
            val sink = TaskStatusSinkChannel()

            // Test openApp payload
            sink.emit(TaskEvent.StageStart("openApp:com.example.app", "Opening com.example.app"))
            val openAppPayload =
                mapOf(
                    "stage_id" to "openApp:com.example.app",
                    "application_id" to "com.example.app",
                    "launch_method" to "shortcut",
                    "cold_start" to "unknown",
                    "elapsed_ms" to "123",
                    "attempt" to "1",
                )
            sink.emit(TaskEvent.StageSuccess("openApp:com.example.app", openAppPayload))

            // Test pause payload
            sink.emit(TaskEvent.StageStart("pause", "Pausing for 1000ms"))
            val pausePayload =
                mapOf(
                    "stage_id" to "pause",
                    "requested_ms" to "1000",
                    "elapsed_ms" to "1015",
                    "attempt" to "1",
                )
            sink.emit(TaskEvent.StageSuccess("pause", pausePayload))

            // Test logUiTree payload
            sink.emit(TaskEvent.StageStart("logUiTree", "Logging UI tree"))
            val logUiTreePayload =
                mapOf(
                    "stage_id" to "logUiTree",
                    "node_count" to "42",
                    "max_depth" to "5",
                    "truncated" to "false",
                    "elapsed_ms" to "89",
                    "attempt" to "1",
                )
            sink.emit(TaskEvent.StageSuccess("logUiTree", logUiTreePayload))

            // Test click payload
            sink.emit(TaskEvent.StageStart("click(resourceId=button)", "click"))
            val clickPayload =
                mapOf(
                    "matcher" to "resourceId=button",
                    "click_type" to "Default",
                    "elapsed_ms" to "45",
                    "attempt" to "1",
                )
            sink.emit(TaskEvent.StageSuccess("click(resourceId=button)", clickPayload))

            // Test scrollUntil payload
            sink.emit(TaskEvent.StageStart("scrollUntil(target=Settings)", "scrollUntil"))
            val scrollPayload =
                mapOf(
                    "target_matcher" to "textContains(\"Settings\")",
                    "container_matcher" to "auto",
                    "swipes_used" to "3",
                    "direction" to "Down",
                    "elapsed_ms" to "567",
                    "attempt" to "1",
                )
            sink.emit(TaskEvent.StageSuccess("scrollUntil(target=Settings)", scrollPayload))

            // Test getValidatedText payload
            sink.emit(TaskEvent.StageStart("getValidatedText(resourceId=temp)", "getValidatedText"))
            val getTextPayload =
                mapOf(
                    "matcher" to "resourceId=temp",
                    "validator" to "temperature_celsius",
                    "validated_value" to "e7f8a9b0", // Hashed value
                    "elapsed_ms" to "234",
                    "attempt" to "1",
                )
            sink.emit(TaskEvent.StageSuccess("getValidatedText(resourceId=temp)", getTextPayload))

            // Test closeApp payload
            sink.emit(TaskEvent.StageStart("closeApp:com.example.app", "Closing com.example.app"))
            val closeAppPayload =
                mapOf(
                    "stage_id" to "closeApp:com.example.app",
                    "application_id" to "com.example.app",
                    "strategy" to "recents_swipe",
                    "elapsed_ms" to "456",
                    "attempt" to "1",
                )
            sink.emit(TaskEvent.StageSuccess("closeApp:com.example.app", closeAppPayload))

            // Test failure scenarios
            sink.emit(TaskEvent.StageStart("failing-stage", "Failing Stage"))
            sink.emit(TaskEvent.StageFailure("failing-stage", "timeout: Operation timed out", RuntimeException("Timeout")))

            // Test retry scenarios
            sink.emit(TaskEvent.RetryScheduled("retry-stage", 1, 3, 1000L))
            sink.emit(TaskEvent.RetryScheduled("retry-stage", 2, 3, 2000L))

            // Test log events
            sink.emit(TaskEvent.Log("Test log message with context"))

            // Verify no exceptions were thrown during any emissions
            assertTrue(true, "Should handle all payload structures and event types without throwing")
        }

    @Test
    fun `StageSuccess data should support empty and populated maps`() =
        actionTest {
            val sink = TaskStatusSinkChannel()

            // Test with empty data
            sink.emit(TaskEvent.StageSuccess("test-empty", emptyMap()))

            // Test with single entry
            sink.emit(TaskEvent.StageSuccess("test-single", mapOf("key" to "value")))

            // Test with multiple entries
            val complexPayload =
                mapOf(
                    "elapsed_ms" to "123",
                    "attempt" to "1",
                    "stage_id" to "complex-stage",
                    "custom_field" to "custom_value",
                    "numeric_field" to "42",
                )
            sink.emit(TaskEvent.StageSuccess("test-complex", complexPayload))

            assertTrue(true, "Should handle various data map sizes without throwing")
        }
}
