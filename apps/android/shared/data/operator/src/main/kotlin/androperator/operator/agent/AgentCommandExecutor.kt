package androperator.operator.agent

import androperator.task.runner.TaskResult
import androperator.task.runner.UiActionExecutionResult

interface AgentCommandExecutor {
    suspend fun execute(command: AgentCommand): TaskResult<UiActionExecutionResult>
}
