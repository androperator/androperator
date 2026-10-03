package androperator.app.close

import action.system.model.ApplicationId

/**
 * Manages app closing operations using Android's Accessibility APIs.
 *
 * **Important Limitations:**
 * - Android does not provide a reliable way to close other apps programmatically
 * - This implementation may not work consistently across all devices and Android versions
 * - Requires an active Accessibility Service with gesture permissions (`android:canPerformGestures="true"`)
 * - Success depends on the device's launcher implementation and Android version
 *
 * **Usage Pattern:**
 * For best reliability, call this after ensuring the target app is in the foreground
 * (e.g., by calling openApp() first), so it appears as the most recent app in Recents.
 */
interface AppCloseManager {
    /**
     * Attempts to close the app with the given applicationId by simulating a swipe gesture in Recents.
     *
     * **Implementation Details:**
     * 1. Opens the Recents apps view using `GLOBAL_ACTION_RECENTS`
     * 2. Performs a swipe-up gesture on the first (most recent) app card
     * 3. Verifies the gesture was successful by checking if the app is no longer in Recents
     *
     * **Important Notes:**
     * - There's no guarantee the first app in Recents is the target app
     * - Reliability can be improved by calling openApp() on the target first
     * - Different Android versions and launchers may require different gesture parameters
     * - The operation may fail silently on some devices due to OEM modifications
     *
     * @param applicationId The package name of the app to close
     * @throws Exception if the gesture fails or verification cannot be performed
     */
    suspend fun closeFirstAppInRecents(applicationId: ApplicationId)
}
