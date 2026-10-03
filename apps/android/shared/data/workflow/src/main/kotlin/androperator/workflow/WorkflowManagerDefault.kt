package androperator.workflow

import action.unit.Temperature
import androperator.task.runner.TaskResult
import androperator.task.runner.TaskRunnerManager
import androperator.task.runner.TaskStatusSink
import androperator.uitree.ToggleState

class WorkflowManagerDefault(
    private val workflowFactory: WorkflowFactory,
    private val taskRunnerManager: TaskRunnerManager,
) : WorkflowManager {
    override suspend fun getAmbientTemperature(status: TaskStatusSink): TaskResult<Temperature> =
        taskRunnerManager.run(status) {
            workflowFactory.getSwitchBotTemperature(this)
        }

    override suspend fun getAirConditionerStatus(status: TaskStatusSink): TaskResult<ToggleState> =
        taskRunnerManager.run(status) {
            workflowFactory.getGoogleHomeAirConditionerStatus(this)
        }

    override suspend fun setAirConditionerStatus(
        desiredState: ToggleState,
        status: TaskStatusSink,
    ): TaskResult<ToggleState> =
        taskRunnerManager.run(status) {
            workflowFactory.setGoogleHomeAirConditionerStatus(this, desiredState)
        }

    override suspend fun toggleGarageDoor(status: TaskStatusSink): TaskResult<Unit> =
        taskRunnerManager.run(status) {
            workflowFactory.toggleSwitchBotSwitch(this)
        }

    override suspend fun logUiTree(status: TaskStatusSink): TaskResult<Unit> =
        taskRunnerManager.run(status) {
            workflowFactory.logUiTree(this)
        }
}
