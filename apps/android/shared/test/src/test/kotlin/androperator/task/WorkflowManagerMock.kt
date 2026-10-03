package androperator.workflow

import action.unit.Temperature
import androperator.task.runner.TaskResult
import androperator.task.runner.TaskStatusSink
import androperator.uitree.ToggleState

class WorkflowManagerMock : WorkflowManager {
    private var ambientTemperature: Temperature = Temperature.Companion.TemperatureC(24.0f)
    private var airConditionerState: ToggleState = ToggleState.Off

    // Failure injection support
    var nextGetTemperatureResult: TaskResult<Temperature>? = null
    var nextGetAirConditionerResult: TaskResult<ToggleState>? = null
    var nextSetAirConditionerResult: TaskResult<ToggleState>? = null
    var nextToggleGarageDoorResult: TaskResult<Unit>? = null

    fun setAmbientTemperature(temperature: Temperature) {
        ambientTemperature = temperature
    }

    fun setAirConditionerState(state: ToggleState) {
        airConditionerState = state
    }

    override suspend fun getAmbientTemperature(status: TaskStatusSink): TaskResult<Temperature> =
        nextGetTemperatureResult?.also { nextGetTemperatureResult = null } ?: TaskResult.Success(ambientTemperature)

    override suspend fun getAirConditionerStatus(status: TaskStatusSink): TaskResult<ToggleState> =
        nextGetAirConditionerResult?.also { nextGetAirConditionerResult = null } ?: TaskResult.Success(airConditionerState)

    override suspend fun setAirConditionerStatus(
        desiredState: ToggleState,
        status: TaskStatusSink
    ): TaskResult<ToggleState> {
        val result = nextSetAirConditionerResult?.also { nextSetAirConditionerResult = null } ?: TaskResult.Success(
            desiredState.also { airConditionerState = it }
        )
        return result
    }

    override suspend fun logUiTree(status: TaskStatusSink): TaskResult<Unit> =
        TaskResult.Success(Unit)

    override suspend fun toggleGarageDoor(status: TaskStatusSink): TaskResult<Unit> =
        nextToggleGarageDoorResult?.also { nextToggleGarageDoorResult = null } ?: TaskResult.Success(Unit)
}
