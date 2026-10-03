package androperator.defaults.apps

import action.devicepackage.DeviceDefaultAppsRepository
import action.log.Log
import androperator.data.trigger.TriggerShortcut
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach

class DefaultAppsRepositoryDefault(
    deviceDefaultAppsRepository: DeviceDefaultAppsRepository,
    coroutineScopeIo: CoroutineScope,
) : DefaultAppsRepository {
    private fun log(message: String) = Log.d("[DefaultApps] $message")

    override val alarmApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.alarmApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("alarmApp: $it") }

    override val audioRecorderApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.audioRecorderApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("audioRecorderApp: $it") }

    override val browserApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.browserApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("browserApp: $it") }

    override val calendarApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.calendarApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("calendarApp: $it") }

    override val cameraApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.cameraApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("cameraApp: $it") }

    override val contactsApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.contactsApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("contactsApp: $it") }

    override val downloadsApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.downloadsApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("downloadsApp: $it") }

    override val documentViewerApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.documentViewerApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("documentViewerApp: $it") }

    override val emailApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.emailApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("emailApp: $it") }

    override val fileManagerApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.fileManagerApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("fileManagerApp: $it") }

    override val galleryApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.galleryApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("galleryApp: $it") }

    override val launcherApplicationId: Flow<String?> =
        deviceDefaultAppsRepository.launcherApplicationId
            .onEach { log("launcherApplicationId: $it") }

    override val mapsApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.mapsApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("mapsApp: $it") }

    override val marketplaceApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.marketplaceApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("marketplaceApp: $it") }

    override val musicApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.musicApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("musicApp: $it") }

    override val phoneApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.phoneApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("phoneApp: $it") }

    override val settingsApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.settingsApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("settingsApp: $it") }

    override val setWallpaperApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.setWallpaperApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("setWallpaperApp: $it") }

    override val smsApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.smsApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("smsApp: $it") }

    override val videoPlayerApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.videoPlayerApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("videoPlayerApp: $it") }

    override val voiceAssistantApp: Flow<TriggerShortcut?> =
        deviceDefaultAppsRepository.voiceAssistantApp
            .map { it?.let { TriggerShortcut(it) } }
            .onEach { log("voiceAssistantApp: $it") }

//    init {
//        combine(
//            alarmApp,
//            audioRecorderApp,
//            browserApp,
//            calendarApp,
//            cameraApp,
//            contactsApp,
//            downloadsApp,
//            documentViewerApp,
//            emailApp,
//            fileManagerApp,
//            galleryApp,
//            mapsApp,
//            marketplaceApp,
//            musicApp,
//            phoneApp,
//            settingsApp,
//            smsApp,
//            videoPlayerApp,
//            voiceAssistantApp,
//        ) {}
//            .stateIn(coroutineScopeIo, started = SharingStarted.Eagerly, initialValue = Unit)
//    }
}
