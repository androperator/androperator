package clawperator.operator.agent

import clawperator.task.runner.UiAction
import clawperator.task.runner.UiActionPlan

data class AgentCommand(
    val commandId: String,
    val taskId: String,
    val source: String,
    val timeoutMs: Long,
    val actions: List<UiAction>,
    val resultSessionId: String? = null,
) {
    fun toPlan(): UiActionPlan = UiActionPlan(
        commandId = commandId,
        taskId = taskId,
        source = source,
        actions = actions,
    )
}
