package androperator.operator.task

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TaskStatusReporterDefaultTest {
    @Test
    fun `local reporting retains task fields without a network client`() = runTest {
        val events = mutableListOf<TaskStatusRequest>()
        val reporter = TaskStatusReporterDefault { events.add(it) }
        val result = reporter.reportStatus("task-1", "device", "finished", "done", 100, "value", null)
        assertTrue(result.isSuccess)
        assertEquals(listOf(TaskStatusRequest("task-1", "device", "finished", "done", 100, "value", null)), events)
    }

    @Test
    fun `local reporting failure is returned to the caller`() = runTest {
        val failure = IllegalStateException("log unavailable")
        val reporter = TaskStatusReporterDefault { throw failure }
        assertEquals(failure, reporter.reportStatus("task-1", "device", "failed", "failed", null, null, "ERROR").exceptionOrNull())
    }
}
