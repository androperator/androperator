package androperator.operator.command

interface OperatorCommandExecutor {
    suspend fun execute(cmd: OperatorCommand)
}
