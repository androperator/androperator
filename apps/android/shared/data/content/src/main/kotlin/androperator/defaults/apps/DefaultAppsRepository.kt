package androperator.defaults.apps

import androperator.data.trigger.TriggerShortcut
import kotlinx.coroutines.flow.Flow

interface DefaultAppsRepository {
    val alarmApp: Flow<TriggerShortcut?>
    val audioRecorderApp: Flow<TriggerShortcut?>
    val browserApp: Flow<TriggerShortcut?>
    val calendarApp: Flow<TriggerShortcut?>
    val cameraApp: Flow<TriggerShortcut?>
    val contactsApp: Flow<TriggerShortcut?>
    val downloadsApp: Flow<TriggerShortcut?>
    val documentViewerApp: Flow<TriggerShortcut?>
    val emailApp: Flow<TriggerShortcut?>
    val fileManagerApp: Flow<TriggerShortcut?>
    val galleryApp: Flow<TriggerShortcut?>

    // Typically a 1st party launcher doesn't have a public facing Intent that appears in a
    // launcher.
    val launcherApplicationId: Flow<String?>
    val mapsApp: Flow<TriggerShortcut?>
    val marketplaceApp: Flow<TriggerShortcut?>
    val musicApp: Flow<TriggerShortcut?>
    val phoneApp: Flow<TriggerShortcut?>
    val settingsApp: Flow<TriggerShortcut?>
    val setWallpaperApp: Flow<TriggerShortcut?>
    val smsApp: Flow<TriggerShortcut?>
    val videoPlayerApp: Flow<TriggerShortcut?>
    val voiceAssistantApp: Flow<TriggerShortcut?>
}
