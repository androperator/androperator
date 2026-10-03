package androperator.urlnavigator

import androperator.data.urlnavigator.UrlNavigatorDestinations
import androperator.test.ActionTest
import kotlin.test.Test
import kotlin.test.assertTrue

class UrlNavigatorDestinationsTest : ActionTest {
    @Test fun validateAllPresets() {
        // Touch all presets (compile-time coverage) and verify invariants.
        val presets =
            listOf(
                UrlNavigatorDestinations.Preset,
                UrlNavigatorDestinations.PresetCustomTab,
                UrlNavigatorDestinations.PresetSearchDefault,
            )

        presets.forEach { preset ->
            assertTrue(preset.destinations.isNotEmpty(), "Preset must not be empty: $preset")
            assertTrue(
                preset.destinations.any { it.isConclusive },
                "Preset must include a conclusive destination: $preset",
            )
        }
    }
}
