package androperator.urlnavigator

import action.activity.StartActivityHelper
import action.system.navigation.SystemNavigator
import android.content.Intent
import androidx.core.net.toUri
import androperator.data.urlnavigator.UrlNavigatorDestination
import androperator.data.urlnavigator.UrlNavigatorDestinations
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.firstOrNull

interface UrlNavigator {
    suspend fun toUrl(
        url: String,
        destinations: UrlNavigatorDestinations,
    ): Boolean

    /**
     * Opens a URI using Android's implicit ACTION_VIEW intent.
     *
     * Unlike [toUrl], this method does not add CATEGORY_BROWSABLE, so it resolves any registered
     * URI handler - including deep links (e.g. market://, geo://) and https URLs - not just browser
     * targets.
     *
     * Returns true if an activity was started, false if no handler was found.
     */
    suspend fun toUri(uri: String): Boolean
}

class UrlNavigatorAndroid(
    private val systemNavigator: SystemNavigator,
    private val defaultAppsRepository: androperator.defaults.apps.DefaultAppsRepository,
    private val startActivityHelper: StartActivityHelper,
) : UrlNavigator {
    private val defaultBrowserApp: Flow<androperator.data.trigger.TriggerShortcut?>
        get() = defaultAppsRepository.browserApp

    private suspend fun getDefaultBrowserApplicationId(): String? = defaultBrowserApp.firstOrNull()?.applicationId

    override suspend fun toUrl(
        url: String,
        destinations: UrlNavigatorDestinations,
    ): Boolean {
        for (destination in destinations.destinations) {
            if (toUrl(url, destination)) {
                return true
            }
        }
        return false
    }

    private suspend fun toUrl(
        url: String,
        destination: UrlNavigatorDestination,
    ): Boolean =
        when (destination) {
            UrlNavigatorDestination.BestSystemOption -> toUrlBestSystemOption(url)
            UrlNavigatorDestination.CustomTab -> toUrlCustomTab(url)
            UrlNavigatorDestination.DefaultBrowser -> toUrlDefaultBrowser(url)
        }

    private suspend fun toUrlBestSystemOption(url: String): Boolean {
        val uri = url.toUri()
        val intent =
            Intent(Intent.ACTION_VIEW, uri)
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return startActivityHelper.startActivity(intent)
    }

    private suspend fun toUrlDefaultBrowser(url: String): Boolean {
        val applicationId = getDefaultBrowserApplicationId() ?: return false

        val intent =
            Intent(Intent.ACTION_VIEW, url.toUri())
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .setPackage(applicationId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return startActivityHelper.startActivity(intent)
    }

    private fun toUrlCustomTab(url: String): Boolean {
        systemNavigator.toUrl(url)
        // Custom tabs don't return a result, so we assume success
        return true
    }

    override suspend fun toUri(uri: String): Boolean {
        val parsedUri = runCatching { uri.toUri() }.getOrNull() ?: return false
        val intent = Intent(Intent.ACTION_VIEW, parsedUri)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return startActivityHelper.startActivity(intent)
    }
}
