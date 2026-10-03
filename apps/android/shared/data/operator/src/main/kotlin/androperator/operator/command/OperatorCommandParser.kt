package androperator.operator.command

import kotlin.time.Duration.Companion.minutes

interface OperatorCommandParser {
    fun parse(
        command: String,
        taskId: String,
        commandDurationMinutesRaw: String?,
        roomNameRaw: String?,
        deviceNameRaw: String?,
        valueRaw: String?,
        modeRaw: String?,
    ): Result<OperatorCommand>
}

class OperatorCommandParserDefault : OperatorCommandParser {
    override fun parse(
        command: String,
        taskId: String,
        commandDurationMinutesRaw: String?,
        roomNameRaw: String?,
        deviceNameRaw: String?,
        valueRaw: String?,
        modeRaw: String?,
    ): Result<OperatorCommand> {
        require(taskId.isNotBlank()) { "taskId is required" }
        val duration = commandDurationMinutesRaw?.toLongOrNull()?.minutes
        return when (command) {
            "ac:on" -> Result.success(OperatorCommand.AirConditionerOn(taskId, duration, deviceNameRaw))
            "ac:off" -> Result.success(OperatorCommand.AirConditionerOff(taskId, duration, deviceNameRaw))
            "ac:status" -> Result.success(OperatorCommand.AirConditionerStatus(taskId, deviceNameRaw))
            "garagedoor:toggle" -> Result.success(OperatorCommand.GarageDoorToggle(taskId))
            "uitree:log" -> Result.success(OperatorCommand.UiTreeLog(taskId))
            "temperature:get" -> Result.success(OperatorCommand.TemperatureGet(taskId))
            "routine:temperature-regulate" -> Result.success(OperatorCommand.TemperatureRegulate(taskId))
            else -> Result.failure(IllegalArgumentException("Unknown command: $command"))
        }
    }
}
