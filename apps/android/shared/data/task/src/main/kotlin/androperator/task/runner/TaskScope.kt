package androperator.task.runner

import action.system.model.ApplicationId
import kotlin.time.Duration

interface TaskScope {
    suspend fun openApp(
        applicationId: ApplicationId,
        retry: TaskRetry = TaskRetry.None,
    )

    /**
     * Opens a URI using Android's implicit ACTION_VIEW intent.
     *
     * The Androperator Android app issues the intent directly; no adb shortcut is used.
     * Unlike [openApp], this accepts any URI scheme - deep links such as market://, https://, or
     * custom app schemes are all valid. The device's default handler for the URI scheme is used.
     *
     * If no application is registered for the URI, the action fails with URI_NOT_HANDLED.
     * A chooser dialog may appear on devices with multiple handlers; agents should follow up with
     * a snapshot_ui step to verify that the expected app is in the foreground.
     *
     * @param uri The URI to open (e.g. "market://details?id=com.actionlauncher.playstore", "https://example.com")
     * @param retry Retry configuration for the launch attempt
     * @throws IllegalStateException if no handler is found for the URI
     */
    suspend fun openUri(
        uri: String,
        retry: TaskRetry = TaskRetry.None,
    )

    suspend fun pause(
        duration: Duration,
        retry: TaskRetry = TaskRetry.None,
    )

    suspend fun logUiTree(
        retry: TaskRetry = TaskRetry.None,
    ): UiSnapshotResult

    /**
     * Polls until the expected package or expected node is found, or the timeout is reached.
     */
    suspend fun waitForNavigation(
        expectedPackage: String?,
        expectedNode: NodeMatcher?,
        timeoutMs: Long,
        allowAlreadyForeground: Boolean = false,
    ): WaitForNavigationResult

    /**
     * Closes (backgrounds) the specified app by simulating a swipe-up gesture.
     * First ensures the app is in the foreground, then performs the gesture to go home.
     *
     * @param applicationId The application ID to close
     * @param retry Retry configuration (defaults to TaskRetry.None, implementations may use TaskRetryPresets.AppClose)
     * @throws Exception if the app cannot be closed after all retry attempts
     */
    suspend fun closeApp(
        applicationId: ApplicationId,
        retry: TaskRetry = TaskRetry.None,
    )

    /**
     * Executes UI inspection and interaction operations within a TaskUiScope.
     * Provides access to UI elements for reading values and performing actions.
     *
     * @param block The UI operations to perform, optionally returning a value
     * @return The value returned by the block, or Unit if no value is returned
     */
    suspend fun <T> ui(block: suspend TaskUiScope.() -> T): T
}

data class WaitForNavigationResult(
    val success: Boolean,
    val lastPackage: String?,
    val elapsedMs: Long,
)
