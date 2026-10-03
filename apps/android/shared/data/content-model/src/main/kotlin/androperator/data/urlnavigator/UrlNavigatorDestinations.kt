package androperator.data.urlnavigator

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@ConsistentCopyVisibility
@Serializable
@SerialName("UrlNavigatorDestinations")
data class UrlNavigatorDestinations private constructor(
    val destinations: List<UrlNavigatorDestination>,
) {
    private constructor(destination: UrlNavigatorDestination) : this(
        destinations = listOf(destination),
    )

    private constructor(vararg destinations: UrlNavigatorDestination) : this(
        destinations = destinations.toList(),
    )

    fun hasFirst(destination: UrlNavigatorDestination): Boolean = destinations.firstOrNull() == destination

    init {
        require(destinations.isNotEmpty()) {
            "At least one destination must be provided"
        }
        require(destinations.any { it.isConclusive }) {
            "Destinations must include a conclusive destination, destinations: $destinations"
        }
    }

    companion object {
        val Preset = UrlNavigatorDestinations(UrlNavigatorDestination.CustomTab)

        val PresetCustomTab = UrlNavigatorDestinations(UrlNavigatorDestination.CustomTab)

        val PresetSearchDefault =
            UrlNavigatorDestinations(
                UrlNavigatorDestination.BestSystemOption,
            )
    }
}
