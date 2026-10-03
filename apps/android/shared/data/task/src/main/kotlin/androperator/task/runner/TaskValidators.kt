package androperator.task.runner

import action.unit.Temperature

/**
 * Pre-configured validator functions for common UI text validation scenarios.
 *
 * These validators provide reusable validation logic for different types of UI elements,
 * helping ensure data quality and reliability in automated tasks.
 */
object TaskValidators {
    /**
     * Validator for temperature readings from smart home devices.
     *
     * Accepts text that can be successfully parsed by Temperature.parse().
     * This includes various temperature formats with units and plain numeric values.
     *
     * Examples of valid text: "20.7°C", "25°C", "23.7", "-5.2", "18", "75°F"
     * Examples of invalid text: "--°C", "", "Loading...", "--", "abc"
     */
    val TemperatureValidator: (String) -> Boolean = { text ->
        Temperature.parse(text) != null
    }

    /**
     * Validator for version numbers (e.g. "16", "14.1.2").
     */
    val VersionValidator: (String) -> Boolean = { text ->
        text.matches(Regex("""^\d+(\.\d+)*$"""))
    }
}
