package androperator.task.runner

import androperator.test.actionTest
import kotlinx.coroutines.withContext
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame
import kotlin.test.assertTrue

class TaskStatusElementTest {
    @Test
    fun `TaskStatusElement should store sink in coroutine context`() {
        // Given
        val sink = TaskStatusSinkNoOp()
        val element = TaskStatusElement(sink)

        // When
        val context = EmptyCoroutineContext + element

        // Then
        val retrievedElement = context[TaskStatusElement]
        assertEquals(element, retrievedElement)
        assertTrue(retrievedElement?.sink is TaskStatusSinkNoOp)
    }

    @Test
    fun `currentTaskStatus should return NoOp when no element in context`() =
        actionTest {
            // Given - Empty coroutine context

            // When
            val sink = currentTaskStatus()

            // Then
            assertTrue(sink is TaskStatusSinkNoOp)
        }

    @Test
    fun `currentTaskStatus should return sink from context element`() =
        actionTest {
            // Given
            val customSink =
                object : TaskStatusSink {
                    override fun emit(event: TaskEvent) {
                        // Custom implementation
                    }
                }

            // When - Run in context with TaskStatusElement
            val sink =
                withContext(EmptyCoroutineContext + TaskStatusElement(customSink)) {
                    currentTaskStatus()
                }

            // Then
            assertSame(customSink, sink)
        }
}
