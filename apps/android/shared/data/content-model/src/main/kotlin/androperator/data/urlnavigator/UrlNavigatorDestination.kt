package androperator.data.urlnavigator

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
@SerialName("UrlNavigatorDestination")
sealed interface UrlNavigatorDestination {
    /**
     * Returns true if this destination conclusively handles the URL
     * and no further destinations need to be attempted.
     */
    val isConclusive: Boolean
        get() = this is DefaultBrowser || this is CustomTab || this is BestSystemOption

    /**
     * URL will open in the "best" available option. Eg, if Instagram is installed,
     * it will open instagram.com links in the Instagram app. If the app is not installed,
     * it will open in the default browser.
     */
    @Serializable
    @SerialName("UrlNavigatorDestination.BestSystemOption")
    data object BestSystemOption : UrlNavigatorDestination

    /**
     * URL will open in the default browser.
     */
    @Serializable
    @SerialName("UrlNavigatorDestination.DefaultBrowser")
    data object DefaultBrowser : UrlNavigatorDestination

    /**
     * URL will open in a custom tab. Use this at times when you wish to display a link
     * without leaving the app.
     */
    @Serializable
    @SerialName("UrlNavigatorDestination.CustomTab")
    data object CustomTab : UrlNavigatorDestination
}
