package androperator.operator.command

import kotlin.time.Duration

sealed interface OperatorCommand {
    val taskId: String

    data class AirConditionerOn(
        override val taskId: String,
        val duration: Duration?,
        val deviceName: String?,
    ) : OperatorCommand

    data class AirConditionerOff(
        override val taskId: String,
        val duration: Duration?,
        val deviceName: String?,
    ) : OperatorCommand

    data class AirConditionerStatus(
        override val taskId: String,
        val deviceName: String?,
    ) : OperatorCommand

    data class UiTreeLog(
        override val taskId: String,
    ) : OperatorCommand

    data class TemperatureGet(
        override val taskId: String,
    ) : OperatorCommand

    data class GarageDoorToggle(
        override val taskId: String,
    ) : OperatorCommand

    data class TemperatureRegulate(
        override val taskId: String,
    ) : OperatorCommand
}
