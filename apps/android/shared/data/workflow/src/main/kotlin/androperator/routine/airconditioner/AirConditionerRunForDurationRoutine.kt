package androperator.routine.airconditioner

import action.time.TimeRepository
import androperator.routine.Routine
import androperator.routine.RoutineSpec
import androperator.routine.RoutineStatusSink
import androperator.routine.RoutineStatusSinkAdapter
import androperator.task.runner.isSuccess
import androperator.task.runner.valueOrNull
import androperator.uitree.ToggleState
import androperator.workflow.WorkflowManager
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.cancellation.CancellationException
import kotlin.coroutines.coroutineContext
import kotlin.time.Duration.Companion.milliseconds

class AirConditionerRunForDurationRoutine(
    private val timeRepository: TimeRepository,
    private val workflowManager: WorkflowManager,
) : Routine {

    private object StageId {
        const val START_ON = "start_on"
        const val RUN_WINDOW = "run_window"
        const val END_OFF = "end_off"
    }

    override suspend fun run(
        routineSpec: RoutineSpec,
        routineStatusSink: RoutineStatusSink,
    ) {
        require(routineSpec is AirConditionerRunForDurationRoutineSpec) {
            "Expected AirConditionerRunForDurationRoutineSpec, got ${routineSpec::class.simpleName}"
        }
        run(spec = routineSpec, sink = routineStatusSink)
    }

    suspend fun run(
        spec: AirConditionerRunForDurationRoutineSpec,
        sink: RoutineStatusSink,
    ) {
        val taskSink = RoutineStatusSinkAdapter(sink)

        var changedStartState = false
        val endElapsedMs = timeRepository.elapsedRealtime + spec.runDuration.inWholeMilliseconds

        // Early cancellation check to make tests deterministic
        coroutineContext.ensureActive()

        try {
            // START_STATE
            val startStateDescription = if (spec.startState == ToggleState.On) "Ensuring AC ON for run" else "Ensuring AC OFF for run"
            sink.stageStart(StageId.START_ON, startStateDescription)
            val current = workflowManager.getAirConditionerStatus(taskSink).valueOrNull

            // Log read failure as per PRD
            if (current == null) {
                sink.log("read_failed", mapOf(
                    "stage" to "start_on",
                    "timestamp_ms" to timeRepository.currentTime.toString(),
                ))
            }

            val shouldChangeStart = current != spec.startState || !spec.skipRedundantStart

            if (shouldChangeStart) {
                val startResult = workflowManager.setAirConditionerStatus(spec.startState, taskSink)
                if (!startResult.isSuccess) {
                    val failureReason = if (spec.startState == ToggleState.On) "set_on_failed" else "set_off_failed"
                    sink.stageFailure(StageId.START_ON, failureReason)
                    return
                }
                changedStartState = true
                sink.stageSuccess(StageId.START_ON)
                val transition = if (spec.startState == ToggleState.On) "air_conditioner_on" else "air_conditioner_off"
                sink.log("state_transition", mapOf(
                    "transition" to transition,
                    "reason" to "run_start",
                    "previous_state" to (current?.name ?: "unknown"),
                    "new_state" to spec.startState.name,
                    "timestamp_ms" to timeRepository.currentTime.toString(),
                ))
            } else {
                sink.stageSuccess(StageId.START_ON)
            }

            // RUN_WINDOW
            val delayMs = (endElapsedMs - timeRepository.elapsedRealtime).coerceAtLeast(0)
            if (delayMs > 0) {
                sink.stageStart(StageId.RUN_WINDOW, "Waiting for run window to complete")
                delay(delayMs.milliseconds)
                sink.stageSuccess(StageId.RUN_WINDOW)
            }

            // END_STATE
            val endStateDescription = if (spec.endState == ToggleState.On) "Turning air conditioner ON at end of run" else "Turning air conditioner OFF at end of run"
            sink.stageStart(StageId.END_OFF, endStateDescription)
            val endResult = workflowManager.setAirConditionerStatus(spec.endState, taskSink)
            if (endResult.isSuccess) {
                sink.stageSuccess(StageId.END_OFF)
                val transition = if (spec.endState == ToggleState.On) "air_conditioner_on" else "air_conditioner_off"
                sink.log("state_transition", mapOf(
                    "transition" to transition,
                    "reason" to "run_complete",
                    "timestamp_ms" to timeRepository.currentTime.toString(),
                ))
            } else {
                val failureReason = if (spec.endState == ToggleState.On) "set_on_failed" else "set_off_failed"
                sink.stageFailure(StageId.END_OFF, failureReason)
            }
        } catch (ce: CancellationException) {
            // On cancel: if we changed the start state, best-effort revert to original state
            if (changedStartState) {
                // Revert to the opposite of startState (which would be endState for cleanup)
                workflowManager.setAirConditionerStatus(spec.endState, taskSink)
                val transition = if (spec.endState == ToggleState.On) "air_conditioner_on" else "air_conditioner_off"
                sink.log("state_transition", mapOf(
                    "transition" to transition,
                    "reason" to "cancelled_cleanup",
                    "timestamp_ms" to timeRepository.currentTime.toString(),
                ))
            }
            throw ce
        }
    }
}
