package androperator.operator.agent

import androperator.task.runner.UiAction
import androperator.task.runner.UiActionPlan

data class AgentCommand(
    val commandId: String,
    val taskId: String,
    val source: String,
    val timeoutMs: Long,
    val actions: List<UiAction>,
) {
    fun toPlan(): UiActionPlan =
        UiActionPlan(
            commandId = commandId,
            taskId = taskId,
            source = source,
            actions = actions,
        )
}
