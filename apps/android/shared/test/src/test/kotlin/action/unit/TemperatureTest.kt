package action.unit

import androperator.test.ActionTest
import androperator.test.actionTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

class TemperatureTest : ActionTest {
    @Test
    fun `TemperatureF creates temperature from Fahrenheit input`() =
        actionTest {
            val temp = Temperature.TemperatureF(75.0f)
            // 75°F = 23.888...°C
            assertEquals(23.88888888888889, temp.celsius, 0.001)
            assertEquals(75.0f, temp.fahrenheit, 0.001f)
            assertEquals("23.9°C", temp.toString())
        }

    @Test
    fun `TemperatureC creates temperature from Celsius input`() =
        actionTest {
            val temp = Temperature.TemperatureC(23.0f)
            assertEquals(23.0, temp.celsius)
            assertEquals(73.4f, temp.fahrenheit, 0.1f)
            assertEquals("23.0°C", temp.toString())
        }

    @Test
    fun `Temperature string parsing - Celsius with degree symbol`() =
        actionTest {
            val temp = Temperature.parse("23.7°C")
            assertNotNull(temp)
            assertEquals(23.7, temp.celsius)
            assertEquals(74.66f, temp.fahrenheit, 0.01f)
        }

    @Test
    fun `Temperature string parsing - Fahrenheit with degree symbol`() =
        actionTest {
            val temp = Temperature.parse("75.0°F")
            // 75°F = 23.888...°C
            assertNotNull(temp)
            assertEquals(23.88888888888889, temp.celsius, 0.001)
            assertEquals(75.0f, temp.fahrenheit, 0.001f)
        }

    @Test
    fun `Temperature string parsing - Celsius without degree symbol uppercase`() =
        actionTest {
            val temp = Temperature.parse("23.7C")
            assertNotNull(temp)
            assertEquals(23.7, temp.celsius)
            assertEquals(74.66f, temp.fahrenheit, 0.01f)
        }

    @Test
    fun `Temperature string parsing - Celsius without degree symbol lowercase`() =
        actionTest {
            val temp = Temperature.parse("23.7c")
            assertNotNull(temp)
            assertEquals(23.7, temp.celsius)
            assertEquals(74.66f, temp.fahrenheit, 0.01f)
        }

    @Test
    fun `Temperature string parsing - Fahrenheit without degree symbol uppercase`() =
        actionTest {
            val temp = Temperature.parse("75.0F")
            assertNotNull(temp)
            assertEquals(23.88888888888889, temp.celsius, 0.001)
            assertEquals(75.0f, temp.fahrenheit, 0.001f)
        }

    @Test
    fun `Temperature string parsing - Fahrenheit without degree symbol lowercase`() =
        actionTest {
            val temp = Temperature.parse("75.0f")
            assertNotNull(temp)
            assertEquals(23.88888888888889, temp.celsius, 0.001)
            assertEquals(75.0f, temp.fahrenheit, 0.001f)
        }

    @Test
    fun `Temperature string parsing - plain numbers assume Celsius`() =
        actionTest {
            val temp = Temperature.parse("23.7")
            assertNotNull(temp)
            assertEquals(23.7, temp.celsius)
            assertEquals(74.66f, temp.fahrenheit, 0.01f)
        }

    @Test
    fun `Temperature string parsing - negative values`() =
        actionTest {
            val temp = Temperature.parse("-5.2°C")
            assertNotNull(temp)
            assertEquals(-5.2, temp.celsius)
            assertEquals(22.64f, temp.fahrenheit, 0.01f)
        }

    @Test
    fun `Temperature string parsing - invalid formats return null`() =
        actionTest {
            assertNull(Temperature.parse(""))
            assertNull(Temperature.parse("   "))
            assertNull(Temperature.parse("--"))
            assertNull(Temperature.parse("--°C"))
            assertNull(Temperature.parse("abc"))
            assertNull(Temperature.parse("23.7°C°F"))
            assertNull(Temperature.parse("not a number"))
        }

    @Test
    fun `Temperature toString formats correctly`() =
        actionTest {
            val celsius = Temperature.TemperatureC(23.5f)
            val fahrenheit = Temperature.TemperatureF(75.0f)

            // Both should display in Celsius since that's our internal representation
            assertEquals("23.5°C", celsius.toString())
            assertEquals("23.9°C", fahrenheit.toString())
        }

    @Test
    fun `cToF converts Celsius to Fahrenheit correctly`() =
        actionTest {
            assertEquals(32.0, Temperature.cToF(0.0), 0.001) // 0°C = 32°F
            assertEquals(68.0, Temperature.cToF(20.0), 0.001) // 20°C = 68°F
            assertEquals(212.0, Temperature.cToF(100.0), 0.001) // 100°C = 212°F
        }

    @Test
    fun `fToC converts Fahrenheit to Celsius correctly`() =
        actionTest {
            assertEquals(0.0, Temperature.fToC(32.0), 0.001) // 32°F = 0°C
            assertEquals(20.0, Temperature.fToC(68.0), 0.001) // 68°F = 20°C
            assertEquals(100.0, Temperature.fToC(212.0), 0.001) // 212°F = 100°C
        }
}
