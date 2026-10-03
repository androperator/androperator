package androperator.task.runner

import androperator.test.ActionTest
import androperator.test.actionTest
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class TaskValidatorsTest : ActionTest {
    @Test
    fun `TemperatureValidator validates correct temperature strings`() =
        actionTest {
            // Valid temperatures with units (uppercase)
            assertTrue(TaskValidators.TemperatureValidator("20.7°C"))
            assertTrue(TaskValidators.TemperatureValidator("25°C"))
            assertTrue(TaskValidators.TemperatureValidator("-5.2°C"))
            assertTrue(TaskValidators.TemperatureValidator("0°C"))
            assertTrue(TaskValidators.TemperatureValidator("23.7°F"))
            assertTrue(TaskValidators.TemperatureValidator("18F"))

            // Valid temperatures with units (lowercase)
            assertTrue(TaskValidators.TemperatureValidator("20.7°c"))
            assertTrue(TaskValidators.TemperatureValidator("25°c"))
            assertTrue(TaskValidators.TemperatureValidator("23.7°f"))
            assertTrue(TaskValidators.TemperatureValidator("18f"))

            // Valid temperatures without units (just numbers)
            assertTrue(TaskValidators.TemperatureValidator("23.7"))
            assertTrue(TaskValidators.TemperatureValidator("25"))
            assertTrue(TaskValidators.TemperatureValidator("-5.2"))
            assertTrue(TaskValidators.TemperatureValidator("0"))

            // Invalid temperatures
            assertFalse(TaskValidators.TemperatureValidator("--°C"))
            assertFalse(TaskValidators.TemperatureValidator("--"))
            assertFalse(TaskValidators.TemperatureValidator(""))
            assertFalse(TaskValidators.TemperatureValidator("Loading..."))
            assertFalse(TaskValidators.TemperatureValidator("°C"))
            assertFalse(TaskValidators.TemperatureValidator("F"))
            assertFalse(TaskValidators.TemperatureValidator("abc"))
        }
}
