package androperator.appnotifications

import action.notification.NotificationData
import action.notification.NotificationListenerConfig
import action.notification.NotificationListenerServiceManager
import action.system.model.ApplicationId
import action.util.MutableFlowList
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map

class AppNotificationsManagerDefault(
    private val config: NotificationListenerConfig,
    private val serviceManager: NotificationListenerServiceManager,
) : AppNotificationsManager {
    private val _allNotifications = MutableFlowList<NotificationData>()
    private val _hiddenPackages = MutableStateFlow<Set<String>>(emptySet())

    // Event flows
    private val _notificationAdded = MutableSharedFlow<NotificationData>()
    private val _notificationRemoved = MutableSharedFlow<NotificationData>()
    private val _notificationUpdated = MutableSharedFlow<NotificationData>()
    private val _visibilityChanged = MutableSharedFlow<String>()

    // Grouped notifications tracking (similar to legacy implementation)
    private val groupKeyToSummaryKey = mutableMapOf<String, String>()
    private val groupKeyToGroupSize = mutableMapOf<String, Int>()

    // Callback for configuration changes (to be set by host app)
    private var onConfigChanged: ((String) -> Unit)? = null

    init {
        // Query initial notifications
        serviceManager.queryActiveNotifications()
    }

    /**
     * Set up configuration change callback.
     * The host app should call this to wire up config change notifications.
     */
    fun setupConfigChangeCallback(callback: (String) -> Unit) {
        onConfigChanged = callback
    }

    /**
     * Handle configuration changes by re-filtering notifications.
     */
    fun handleConfigChange(key: String) {
        // Re-filter current notifications when config changes
        val current = _allNotifications.contents
        _allNotifications.clear()
        _allNotifications.addAll(current.filter { shouldInclude(it) })
        _visibilityChanged.tryEmit(key)
    }

    override fun getNotifications(applicationId: ApplicationId?): Flow<List<NotificationData>> {
        return _allNotifications.listFlow.map { notifications ->
            if (applicationId == null) {
                return@map notifications
                    .filter { !isPackageHidden(it.applicationId) && !isPackageDisabled(it.applicationId) }
            }

            if (isPackageDisabled(applicationId) || isPackageHidden(applicationId)) {
                return@map emptyList()
            }

            notifications
                .filter { it.applicationId == applicationId }
        }
    }

    override fun getNotificationCount(applicationId: ApplicationId?): Flow<Int> =
        getNotifications(applicationId).map { notifications ->
            notifications?.size ?: 0 // In legacy code, this used notification.number, but we'll keep it simple
        }

    override fun hasNotifications(applicationId: ApplicationId?): Flow<Boolean> = getNotifications(applicationId).map { it != null && it.isNotEmpty() }

    override fun hideNotifications(
        applicationId: ApplicationId,
        hide: Boolean,
    ) {
        val currentHidden = _hiddenPackages.value.toMutableSet()
        if (hide) {
            currentHidden.add(applicationId)
        } else {
            currentHidden.remove(applicationId)
        }
        _hiddenPackages.value = currentHidden
        _visibilityChanged.tryEmit(applicationId)
    }

    override val allNotifications: Flow<List<NotificationData>?>
        get() = _allNotifications.listFlow

    override val notificationAdded: Flow<NotificationData> =
        flow {
            serviceManager.notificationAdded.collect { notification ->
                handleNotificationAddedOrUpdated(notification)
                emit(notification)
            }
        }

    override val notificationRemoved: Flow<NotificationData> =
        flow {
            serviceManager.notificationRemoved.collect { notification ->
                handleNotificationRemoved(notification)
                emit(notification)
            }
        }

    override val notificationUpdated: Flow<NotificationData> = _notificationUpdated.asSharedFlow()

    override val visibilityChanged: Flow<String> = _visibilityChanged.asSharedFlow()

    /**
     * Initialize the manager by collecting active notifications.
     * This method can be called to refresh the current state.
     */
    fun initialize() {
        serviceManager.queryActiveNotifications()
    }

    /**
     * Get the current snapshot of all notifications (non-reactive).
     */
    fun getCurrentNotifications(): List<NotificationData> = _allNotifications.contents

    /**
     * Get notification count for a package (non-reactive).
     */
    fun getCurrentCountFor(applicationId: ApplicationId?): Int {
        val notifications =
            if (applicationId == null) {
                _allNotifications.contents.filter { !isPackageHidden(it.applicationId) && !isPackageDisabled(it.applicationId) }
            } else {
                if (isPackageDisabled(applicationId) || isPackageHidden(applicationId)) {
                    emptyList()
                } else {
                    _allNotifications.contents.filter { it.applicationId == applicationId }
                }
            }
        return notifications.size
    }

    /**
     * Clean up resources and reset state.
     *
     * Note: This only clears in-memory state. It does not unregister any BroadcastReceivers
     * or cancel coroutines since AppNotificationsManagerDefault doesn't hold these resources.
     *
     * The host application should also call:
     * - config.destroy() to unregister SharedPreferences listeners
     * - serviceManager.cleanup() to unregister broadcast receivers
     */
    override fun destroy() {
        // Clear all state
        _allNotifications.clear()
        _hiddenPackages.value = emptySet()
        groupKeyToSummaryKey.clear()
        groupKeyToGroupSize.clear()
        onConfigChanged = null
    }

    private fun handleNotificationsQueried(notifications: List<NotificationData>) {
        // Clear current data and process new notifications
        clearAllNotifications()

        val filteredNotifications =
            notifications.filter { notification ->
                shouldInclude(notification)
            }

        _allNotifications.addAll(filteredNotifications.sortedBy { it.postTime })

        // Emit added events for all notifications
        filteredNotifications.forEach { notification ->
            _notificationAdded.tryEmit(notification)
        }
    }

    private fun handleNotificationAddedOrUpdated(notification: NotificationData) {
        // Handle group summary notifications separately
        if (notification.isGroupSummary) {
            handleNotificationRemoved(notification)
            notification.groupKey?.let { groupKey ->
                groupKeyToSummaryKey[groupKey] = notification.key
            }
            return
        }
        // Apply full filtering logic including intent filtering
        if (!shouldInclude(notification)) {
            handleNotificationRemoved(notification)
            return
        }
        val existingIndex = _allNotifications.indexOfFirst { it.key == notification.key }
        if (existingIndex >= 0) {
            // Update existing notification
            _allNotifications.set(existingIndex, notification)
            _notificationUpdated.tryEmit(notification)
        } else {
            // Add new notification and track group
            notification.groupKey?.let { groupKey ->
                val groupSize = groupKeyToGroupSize[groupKey] ?: 0
                groupKeyToGroupSize[groupKey] = groupSize + 1
            }
            // Insert in sorted order by postTime
            val insertIndex = _allNotifications.contents.indexOfFirst { it.postTime > notification.postTime }
            if (insertIndex == -1) {
                _allNotifications.add(notification)
            } else {
                _allNotifications.add(insertIndex, notification)
            }
            _notificationAdded.tryEmit(notification)
        }
    }

    private fun handleNotificationRemoved(notification: NotificationData) {
        val existingIndex = _allNotifications.indexOfFirst { it.key == notification.key }
        if (existingIndex >= 0) {
            // Handle group tracking
            notification.groupKey?.let { groupKey ->
                val groupSize = groupKeyToGroupSize[groupKey]
                if (groupSize != null) {
                    if (groupSize == 1) {
                        // Last notification in group - cancel summary
                        val summaryKey = groupKeyToSummaryKey[groupKey]
                        summaryKey?.let { key ->
                            serviceManager.cancelNotification(key)
                        }
                        groupKeyToGroupSize.remove(groupKey)
                        groupKeyToSummaryKey.remove(groupKey)
                    } else {
                        groupKeyToGroupSize[groupKey] = groupSize - 1
                    }
                }
            }
            _allNotifications.removeAt(existingIndex)
            _notificationRemoved.tryEmit(notification)
        }
    }

    private fun clearAllNotifications() {
        val currentNotifications = _allNotifications.contents
        currentNotifications.forEach { notification ->
            _notificationRemoved.tryEmit(notification)
        }
        _allNotifications.clear()
    }

    private fun isPackageDisabled(applicationId: ApplicationId): Boolean = config.areNotificationsDisabledFor(applicationId)

    private fun isPackageHidden(applicationId: ApplicationId): Boolean = _hiddenPackages.value.contains(applicationId)

    private fun isOngoingOrGroupSummary(notification: NotificationData): Boolean = notification.isGroupSummary || notification.isOngoing

    private fun shouldInclude(notification: NotificationData): Boolean =
        !isOngoingOrGroupSummary(notification) &&
            !isPackageDisabled(notification.applicationId) &&
            config.canShowNotificationForIntent(notification.intentAction, notification.intentCategories)
}
