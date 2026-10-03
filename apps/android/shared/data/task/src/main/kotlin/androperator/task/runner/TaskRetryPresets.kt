package androperator.task.runner

import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

/**
 * Pre-configured retry strategies for common task operations.
 *
 * These presets provide sensible defaults for different types of operations,
 * balancing reliability with user experience (not retrying too aggressively).
 */
object TaskRetryPresets {
    /**
     * Retry preset for UI readiness checks.
     * More attempts with moderate delays to handle UI loading variability.
     */
    val UiReadiness =
        TaskRetry.exponential(
            maxAttempts = 5,
            initialDelay = 500.milliseconds,
            maxDelay = 3.seconds,
        )

    /**
     * Retry preset for app launching operations.
     * Moderate attempts with longer delays to account for app startup time.
     */
    val AppLaunch =
        TaskRetry.exponential(
            maxAttempts = 4,
            initialDelay = 750.milliseconds,
            maxDelay = 4.seconds,
        )

    /**
     * Retry preset for app closing operations.
     * Faster initial retry with shorter max delay for quicker user feedback.
     * Optimized for the multi-strategy gesture approach used in app closing.
     */
    val AppClose =
        TaskRetry.exponential(
            maxAttempts = 4,
            initialDelay = 400.milliseconds,
            maxDelay = 2.seconds,
        )

    /**
     * Retry preset for UI scrolling operations.
     * Moderate attempts with delays suitable for scroll gestures and UI settling.
     */
    val UiScroll =
        TaskRetry.exponential(
            maxAttempts = 4,
            initialDelay = 400.milliseconds,
            maxDelay = 2.seconds,
        )
}
