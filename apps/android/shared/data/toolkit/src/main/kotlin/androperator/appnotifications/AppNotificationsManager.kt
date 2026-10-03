package androperator.appnotifications

import action.notification.NotificationData
import action.system.model.ApplicationId
import kotlinx.coroutines.flow.Flow

/**
 * Interface for managing app notifications with Flow-based APIs.
 * This replaces the legacy NotificationStorage interface.
 */
interface AppNotificationsManager {
    /**
     * Get notifications for a specific package as a Flow.
     * @param applicationId The package name to filter by, or null for all notifications
     */
    fun getNotifications(applicationId: ApplicationId?): Flow<List<NotificationData>>

    /**
     * Get notification count for a specific package as a Flow.
     * @param applicationId The package name to count for, or null for all notifications
     */
    fun getNotificationCount(applicationId: ApplicationId?): Flow<Int>

    /**
     * Check if notifications exist for a package as a Flow.
     * @param applicationId The package name to check, or null for any notifications
     */
    fun hasNotifications(applicationId: ApplicationId?): Flow<Boolean>

    /**
     * Hide or show notifications for a specific package.
     * @param applicationId The package name to hide/show notifications for
     * @param hide True to hide notifications, false to show them
     */
    fun hideNotifications(
        applicationId: ApplicationId,
        hide: Boolean,
    )

    /**
     * Flow of all currently active notifications.
     */
    val allNotifications: Flow<List<NotificationData>?>

    /**
     * Flow of notification added events.
     */
    val notificationAdded: Flow<NotificationData>

    /**
     * Flow of notification removed events.
     */
    val notificationRemoved: Flow<NotificationData>

    /**
     * Flow of notification updated events.
     */
    val notificationUpdated: Flow<NotificationData>

    /**
     * Flow of notification visibility changed events for packages.
     */
    val visibilityChanged: Flow<String>

    /**
     * Clean up resources and unregister listeners.
     */
    fun destroy()
}
