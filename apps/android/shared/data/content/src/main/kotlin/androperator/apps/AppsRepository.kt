package androperator.apps

import action.system.model.ApplicationId
import androperator.data.trigger.TriggerShortcut
import kotlinx.coroutines.flow.Flow

interface AppsRepository {
    val allUserFacingTriggerShortcuts: Flow<List<TriggerShortcut>?>

    fun findTriggerShortcut(applicationId: ApplicationId): Flow<TriggerShortcut?>

    val amazonApp: Flow<TriggerShortcut?>
    val bingApp: Flow<TriggerShortcut?>
    val braveBrowserApp: Flow<TriggerShortcut?>
    val chromeApp: Flow<TriggerShortcut?>
    val chromeBetaApp: Flow<TriggerShortcut?>
    val chromeCanaryApp: Flow<TriggerShortcut?>
    val chromeDevApp: Flow<TriggerShortcut?>
    val chatGptApp: Flow<TriggerShortcut?>
    val duckDuckGoApp: Flow<TriggerShortcut?>
    val gmailApp: Flow<TriggerShortcut?>
    val googleMapsApp: Flow<TriggerShortcut?>
    val googleDriveApp: Flow<TriggerShortcut?>
    val googleNewsApp: Flow<TriggerShortcut?>
    val googlePlayApp: Flow<TriggerShortcut?>
    val googleSearchApp: Flow<TriggerShortcut?>
    val googleWallpaperApp: Flow<TriggerShortcut?>
    val netflixApp: Flow<TriggerShortcut?>
    val perplexityApp: Flow<TriggerShortcut?>
    val redditApp: Flow<TriggerShortcut?>
    val spotifyApp: Flow<TriggerShortcut?>
    val startpageApp: Flow<TriggerShortcut?>
    val youTubeApp: Flow<TriggerShortcut?>
    val youTubeMusicApp: Flow<TriggerShortcut?>
    val zoomApp: Flow<TriggerShortcut?>

    val defaultAlarmApp: Flow<TriggerShortcut?>
    val defaultAudioRecorderApp: Flow<TriggerShortcut?>
    val defaultBrowserApp: Flow<TriggerShortcut?>
    val defaultCalendarApp: Flow<TriggerShortcut?>
    val defaultCameraApp: Flow<TriggerShortcut?>
    val defaultContactsApp: Flow<TriggerShortcut?>
    val defaultDocumentViewerApp: Flow<TriggerShortcut?>
    val defaultDownloadsApp: Flow<TriggerShortcut?>
    val defaultEmailApp: Flow<TriggerShortcut?>
    val defaultFileManagerApp: Flow<TriggerShortcut?>
    val defaultGalleryApp: Flow<TriggerShortcut?>
    val defaultLauncherApplicationId: Flow<String?>
    val defaultMapsApp: Flow<TriggerShortcut?>
    val defaultMarketplaceApp: Flow<TriggerShortcut?>
    val defaultMusicApp: Flow<TriggerShortcut?>
    val defaultPhoneApp: Flow<TriggerShortcut?>
    val defaultSettingsApp: Flow<TriggerShortcut?>
    val defaultSmsApp: Flow<TriggerShortcut?>
    val defaultVideoPlayerApp: Flow<TriggerShortcut?>
    val defaultVoiceAssistantApp: Flow<TriggerShortcut?>
    val defaultSetWallpaperApp: Flow<TriggerShortcut?>

    val bestBrowserApp: Flow<TriggerShortcut?>
    val bestCalendarApp: Flow<TriggerShortcut?>
    val bestCameraApp: Flow<TriggerShortcut?>
    val bestGalleryApp: Flow<TriggerShortcut?>
    val bestMapsApp: Flow<TriggerShortcut?>
    val bestMusicApp: Flow<TriggerShortcut?>
    val bestPhoneApp: Flow<TriggerShortcut?>
    val bestSmsApp: Flow<TriggerShortcut?>

    val allGoogleApps: Flow<List<TriggerShortcut>>

    val knownAudioApps: Flow<List<TriggerShortcut>?>
    val knownCalendarApps: Flow<List<TriggerShortcut>?>
    val knownMessagingApps: Flow<List<TriggerShortcut>?>
    val knownNewsApps: Flow<List<TriggerShortcut>?>
    val knownProductivityApps: Flow<List<TriggerShortcut>?>
    val knownSearchEndpointApps: Flow<List<TriggerShortcut>?>
    val knownShoppingApps: Flow<List<TriggerShortcut>?>
    val knownSocialApps: Flow<List<TriggerShortcut>?>
    val knownVideoApps: Flow<List<TriggerShortcut>?>
}
