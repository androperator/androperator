package androperator.workflow

import action.unit.Temperature
import androperator.task.runner.TaskResult
import androperator.task.runner.TaskStatusSink
import androperator.uitree.ToggleState

interface WorkflowManager {
    suspend fun getAmbientTemperature(
        status: TaskStatusSink,
    ): TaskResult<Temperature>

    suspend fun getAirConditionerStatus(
        status: TaskStatusSink,
    ): TaskResult<ToggleState>

    suspend fun setAirConditionerStatus(
        desiredState: ToggleState,
        status: TaskStatusSink,
    ): TaskResult<ToggleState>

    suspend fun toggleGarageDoor(
        status: TaskStatusSink,
    ): TaskResult<Unit>

    suspend fun logUiTree(
        status: TaskStatusSink,
    ): TaskResult<Unit>
}
