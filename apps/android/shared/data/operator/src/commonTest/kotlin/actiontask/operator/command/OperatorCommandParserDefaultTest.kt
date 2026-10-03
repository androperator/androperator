package androperator.operator.command

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class OperatorCommandParserDefaultTest {
    private val parser = OperatorCommandParserDefault()

    @Test
    fun `parse ac status command`() {
        val result =
            parser.parse(
                command = "ac:status",
                taskId = "task-1",
                commandDurationMinutesRaw = null,
                roomNameRaw = null,
                deviceNameRaw = null,
                valueRaw = null,
                modeRaw = null,
            )

        assertTrue(result.isSuccess)
        val command = result.getOrThrow()
        assertIs<OperatorCommand.AirConditionerStatus>(command)
        assertEquals(null, command.deviceName)
    }

    @Test
    fun `parse ac on command with device name`() {
        val result =
            parser.parse(
                command = "ac:on",
                taskId = "task-2",
                commandDurationMinutesRaw = "15",
                roomNameRaw = null,
                deviceNameRaw = "AirTouch AC 1",
                valueRaw = null,
                modeRaw = null,
            )

        assertTrue(result.isSuccess)
        val command = result.getOrThrow()
        assertIs<OperatorCommand.AirConditionerOn>(command)
        assertEquals("AirTouch AC 1", command.deviceName)
    }

    @Test
    fun `parse ac off command with device name`() {
        val result =
            parser.parse(
                command = "ac:off",
                taskId = "task-3",
                commandDurationMinutesRaw = null,
                roomNameRaw = null,
                deviceNameRaw = "Master, Thermostat",
                valueRaw = null,
                modeRaw = null,
            )

        assertTrue(result.isSuccess)
        val command = result.getOrThrow()
        assertIs<OperatorCommand.AirConditionerOff>(command)
        assertEquals("Master, Thermostat", command.deviceName)
    }
}
