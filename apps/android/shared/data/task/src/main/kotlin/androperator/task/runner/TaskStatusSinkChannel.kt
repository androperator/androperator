package androperator.task.runner

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

/**
 * Channel-backed implementation of TaskStatusSink that exposes events as a SharedFlow.
 *
 * This implementation allows observers to collect task execution events in real-time.
 * Useful for UI integration, testing, and external monitoring systems.
 *
 * @param buffer The buffer capacity for the underlying SharedFlow (default: 64)
 */
class TaskStatusSinkChannel(
    buffer: Int = 64,
) : TaskStatusSink {
    private val _events =
        MutableSharedFlow<TaskEvent>(
            extraBufferCapacity = buffer,
            onBufferOverflow = kotlinx.coroutines.channels.BufferOverflow.DROP_OLDEST,
        )

    /**
     * SharedFlow that emits task execution events.
     * Multiple observers can collect from this flow simultaneously.
     */
    val events: SharedFlow<TaskEvent> = _events

    override fun emit(event: TaskEvent) {
        _events.tryEmit(event)
    }
}
