package androperator.routine

import androperator.task.runner.TaskEvent
import androperator.task.runner.TaskStatusSink

/**
 * Adapter to convert TaskStatusSink events to RoutineStatusSink calls.
 */
internal class RoutineStatusSinkAdapter(
    private val routineSink: RoutineStatusSink
) : TaskStatusSink {
    override fun emit(event: TaskEvent) {
        when (event) {
            is TaskEvent.StageStart -> routineSink.stageStart(event.id, event.label)
            is TaskEvent.StageSuccess -> routineSink.stageSuccess(event.id, event.data)
            is TaskEvent.StageFailure -> routineSink.stageFailure(event.id, event.reason)
            is TaskEvent.Log -> routineSink.log(event.message)
            is TaskEvent.RetryScheduled -> {
                // For retry events, just log them as informational messages
                routineSink.log("Retry scheduled for ${event.stageId}: attempt ${event.attempt}/${event.maxAttempts} in ${event.nextDelayMs}ms")
            }
        }
    }
}
