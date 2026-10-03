package androperator.apps

import action.coroutine.flow.combineDistinct
import action.coroutine.flow.mapDistinct
import action.devicepackage.DevicePackageRepository
import action.system.model.ApplicationId
import androperator.data.trigger.TriggerShortcut
import androperator.data.trigger.componentKey
import androperator.defaults.apps.DefaultAppsRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

class AppsRepositoryDefault(
    private val defaultAppsRepository: DefaultAppsRepository,
    knownAppsRepository: KnownAppsRepository,
    private val devicePackageRepository: DevicePackageRepository,
) : AppsRepository {
    override val allUserFacingTriggerShortcuts: Flow<List<TriggerShortcut>?>
        get() =
            devicePackageRepository.allUserFacingDeviceApps
                .map { deviceApps ->
                    deviceApps?.map { TriggerShortcut(it) }
                }.distinctUntilChanged()

    override fun findTriggerShortcut(applicationId: ApplicationId): Flow<TriggerShortcut?> =
        allUserFacingTriggerShortcuts.map { shortcuts ->
            shortcuts?.firstOrNull { it.route?.componentKey?.applicationId == applicationId }
        }

    override val amazonApp = findTriggerShortcut(knownAppsRepository.amazonApplicationId)
    override val bingApp = findTriggerShortcut(knownAppsRepository.bingApplicationId)
    override val braveBrowserApp = findTriggerShortcut(knownAppsRepository.braveApplicationId)
    override val chromeApp = findTriggerShortcut(knownAppsRepository.chromeApplicationId)
    override val chromeBetaApp = findTriggerShortcut(knownAppsRepository.chromeBetaApplicationId)
    override val chromeCanaryApp = findTriggerShortcut(knownAppsRepository.chromeCanaryApplicationId)
    override val chromeDevApp = findTriggerShortcut(knownAppsRepository.chromeDevApplicationId)
    override val chatGptApp = findTriggerShortcut(knownAppsRepository.chatGptApplicationId)
    override val duckDuckGoApp = findTriggerShortcut(knownAppsRepository.duckDuckGoApplicationId)
    override val gmailApp = findTriggerShortcut(knownAppsRepository.gmailApplicationId)
    override val googleMapsApp = findTriggerShortcut(knownAppsRepository.googleMapsApplicationId)
    override val googleDriveApp = findTriggerShortcut(knownAppsRepository.googleDriveApplicationId)
    override val googleNewsApp = findTriggerShortcut(knownAppsRepository.googleNewsApplicationId)
    override val googlePlayApp = findTriggerShortcut(knownAppsRepository.googlePlayApplicationId)
    override val googleSearchApp = findTriggerShortcut(knownAppsRepository.googleSearchApplicationId)
    override val googleWallpaperApp = findTriggerShortcut(knownAppsRepository.googleWallpaperApplicationId)
    override val netflixApp = findTriggerShortcut(knownAppsRepository.netflixApplicationId)
    override val perplexityApp = findTriggerShortcut(knownAppsRepository.perplexityApplicationId)
    override val redditApp = findTriggerShortcut(knownAppsRepository.redditApplicationId)
    override val spotifyApp = findTriggerShortcut(knownAppsRepository.spotifyApplicationId)
    override val startpageApp = findTriggerShortcut(knownAppsRepository.startpageApplicationId)
    override val youTubeApp = findTriggerShortcut(knownAppsRepository.youTubeApplicationId)
    override val youTubeMusicApp = findTriggerShortcut(knownAppsRepository.youTubeMusicApplicationId)
    override val zoomApp = findTriggerShortcut(knownAppsRepository.zoomApplicationId)

    override val defaultAlarmApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.alarmApp
    override val defaultAudioRecorderApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.audioRecorderApp
    override val defaultBrowserApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.browserApp
    override val defaultCalendarApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.calendarApp
    override val defaultCameraApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.cameraApp
    override val defaultContactsApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.contactsApp
    override val defaultDocumentViewerApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.documentViewerApp
    override val defaultDownloadsApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.downloadsApp
    override val defaultEmailApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.emailApp
    override val defaultFileManagerApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.fileManagerApp
    override val defaultGalleryApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.galleryApp
    override val defaultLauncherApplicationId: Flow<String?> get() = defaultAppsRepository.launcherApplicationId
    override val defaultMapsApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.mapsApp
    override val defaultMarketplaceApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.marketplaceApp
    override val defaultMusicApp: Flow<TriggerShortcut?> get() =
        combineDistinct(
            defaultAppsRepository.musicApp,
            youTubeMusicApp,
            spotifyApp,
        ) { musicApp, youTubeMusicApp, spotifyApp ->
            musicApp ?: spotifyApp ?: youTubeMusicApp
        }
    override val defaultPhoneApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.phoneApp
    override val defaultSettingsApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.settingsApp
    override val defaultSmsApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.smsApp
    override val defaultVideoPlayerApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.videoPlayerApp
    override val defaultVoiceAssistantApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.voiceAssistantApp
    override val defaultSetWallpaperApp: Flow<TriggerShortcut?> get() = defaultAppsRepository.setWallpaperApp

    private fun Flow<TriggerShortcut?>.findBestApp(applicationIds: Flow<List<String>>): Flow<TriggerShortcut?> =
        combineDistinct(
            this,
            allUserFacingTriggerShortcuts,
            applicationIds,
        ) { defaultApp, allUserShortcuts, ids ->
            defaultApp
                ?: ids.firstNotNullOfOrNull { id ->
                    allUserShortcuts?.firstOrNull { it.route?.componentKey?.applicationId == id }
                }
        }

    override val bestBrowserApp: Flow<TriggerShortcut?> =
        mapDistinct(
            defaultAppsRepository.browserApp.findBestApp(knownAppsRepository.browserApplicationIds),
        ) { defaultBrowserApp ->
            defaultBrowserApp
        }
    override val bestCameraApp = defaultAppsRepository.cameraApp.findBestApp(knownAppsRepository.cameraApplicationIds)
    override val bestCalendarApp = defaultAppsRepository.calendarApp.findBestApp(knownAppsRepository.calendarApplicationIds)
    override val bestGalleryApp = defaultAppsRepository.galleryApp.findBestApp(knownAppsRepository.galleryApplicationIds)
    override val bestMapsApp = defaultAppsRepository.mapsApp.findBestApp(knownAppsRepository.mapsApplicationIds)
    override val bestMusicApp = defaultAppsRepository.musicApp.findBestApp(knownAppsRepository.musicApplicationIds)
    override val bestPhoneApp = defaultAppsRepository.phoneApp.findBestApp(knownAppsRepository.phoneApplicationIds)
    override val bestSmsApp = defaultAppsRepository.smsApp.findBestApp(knownAppsRepository.messagingApplicationIds)

    override val allGoogleApps: Flow<List<TriggerShortcut>> =
        devicePackageRepository.allUserFacingDeviceApps
            .map { deviceApps ->
                deviceApps
                    ?.filter {
                        val applicationId = it.applicationId
                        applicationId.startsWith("com.google") ||
                            applicationId.startsWith("com.android.chrome") ||
                            applicationId.startsWith("com.android.vending")
                    }?.map { TriggerShortcut(it) }
                    ?: emptyList()
            }

    fun List<TriggerShortcut>.filterByAppIds(ids: List<String>): List<TriggerShortcut> =
        this.filter {
            val componentKey = it.route?.componentKey
            componentKey != null && ids.contains(componentKey.applicationId)
        }

    override val knownAudioApps: Flow<List<TriggerShortcut>?> =
        combineDistinct(allUserFacingTriggerShortcuts, knownAppsRepository.audioApplicationIds) { userShortcuts, ids ->
            userShortcuts?.filterByAppIds(ids)
        }
    override val knownCalendarApps: Flow<List<TriggerShortcut>?> =
        combineDistinct(allUserFacingTriggerShortcuts, knownAppsRepository.calendarApplicationIds) { userShortcuts, ids ->
            userShortcuts?.filterByAppIds(ids)
        }
    override val knownMessagingApps: Flow<List<TriggerShortcut>?> =
        combineDistinct(allUserFacingTriggerShortcuts, knownAppsRepository.messagingApplicationIds) { userShortcuts, ids ->
            userShortcuts?.filterByAppIds(ids)
        }
    override val knownNewsApps: Flow<List<TriggerShortcut>?> =
        combineDistinct(allUserFacingTriggerShortcuts, knownAppsRepository.newsApplicationIds) { userShortcuts, ids ->
            userShortcuts?.filterByAppIds(ids)
        }
    override val knownProductivityApps: Flow<List<TriggerShortcut>?> =
        combineDistinct(allUserFacingTriggerShortcuts, knownAppsRepository.productivityApplicationIds) { userShortcuts, ids ->
            userShortcuts?.filterByAppIds(ids)
        }
    override val knownSearchEndpointApps: Flow<List<TriggerShortcut>?> =
        combineDistinct(allUserFacingTriggerShortcuts, knownAppsRepository.searchEndpointApplicationIds) { userShortcuts, ids ->
            userShortcuts?.filterByAppIds(ids)
        }
    override val knownShoppingApps: Flow<List<TriggerShortcut>?> =
        combineDistinct(allUserFacingTriggerShortcuts, knownAppsRepository.shoppingApplicationIds) { userShortcuts, ids ->
            userShortcuts?.filterByAppIds(ids)
        }
    override val knownSocialApps: Flow<List<TriggerShortcut>?> =
        combineDistinct(allUserFacingTriggerShortcuts, knownAppsRepository.socialApplicationIds) { userShortcuts, ids ->
            userShortcuts?.filterByAppIds(ids)
        }
    override val knownVideoApps: Flow<List<TriggerShortcut>?> =
        combineDistinct(allUserFacingTriggerShortcuts, knownAppsRepository.videoApplicationIds) { userShortcuts, ids ->
            userShortcuts?.filterByAppIds(ids)
        }
}
