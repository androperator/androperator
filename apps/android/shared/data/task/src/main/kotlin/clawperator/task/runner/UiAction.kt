package clawperator.task.runner

import action.math.geometry.Point
import clawperator.uitree.UiTreeClickTypes

/**
 * Typed generic UI automation actions that can be executed by UiActionEngine.
 */
sealed interface UiAction {
    val id: String

    data class NotificationMedia(
        override val id: String,
        val type: String,
        val applicationId: String? = null,
        val mediaSessionId: String? = null,
        val limit: Int = 25,
        val maxTextChars: Int = 256,
        val waitTimeoutMs: Long = 0,
        val notificationKey: String? = null,
        val actionId: String? = null,
        val positionMs: Long? = null,
        val positionToleranceMs: Long = 1000,
        val durationMs: Long = 0,
    ) : UiAction

    data class OpenUri(
        override val id: String,
        val uri: String,
        val retry: TaskRetry = TaskRetryPresets.AppLaunch,
    ) : UiAction

    data class OpenApp(
        override val id: String,
        val applicationId: String,
        val skipNavigationWait: Boolean = false,
        val navigationTimeoutMs: Long = 15_000L,
        val retry: TaskRetry = TaskRetryPresets.AppLaunch,
    ) : UiAction

    data class CloseApp(
        override val id: String,
        val applicationId: String,
        val retry: TaskRetry = TaskRetryPresets.AppClose,
    ) : UiAction

    data class WaitForNode(
        override val id: String,
        val matcher: NodeMatcher,
        val retry: TaskRetry = TaskRetryPresets.UiReadiness,
        val timeoutMs: Long? = null,
        val strict: Boolean = false,
        val container: NodeMatcher? = null,
    ) : UiAction

    data class Swipe(
        override val id: String,
        val start: Point,
        val end: Point,
        val durationMs: Long,
    ) : UiAction

    data class Click(
        override val id: String,
        val matcher: NodeMatcher? = null,
        val coordinate: Point? = null,
        val clickTypes: UiTreeClickTypes = UiTreeClickTypes.Default,
        val retry: TaskRetry = TaskRetryPresets.UiReadiness,
        val strict: Boolean = false,
        val container: NodeMatcher? = null,
    ) : UiAction

    data class ScrollAndClick(
        override val id: String,
        val matcher: NodeMatcher,
        val container: NodeMatcher? = null,
        val clickTypes: UiTreeClickTypes = UiTreeClickTypes.Default,
        val direction: TaskScrollDirection = TaskScrollDirection.Down,
        val maxSwipes: Int = 10,
        val distanceRatio: Float = 0.7f,
        val settleDelayMs: Long = 250,
        val scrollRetry: TaskRetry = TaskRetryPresets.UiScroll,
        val clickRetry: TaskRetry = TaskRetryPresets.UiReadiness,
        val findFirstScrollableChild: Boolean = true,
        /** When false, scrolls until the target is visible but does not click it. */
        val clickAfter: Boolean = true,
        val strict: Boolean = false,
    ) : UiAction

    data class Scroll(
        override val id: String,
        val container: NodeMatcher? = null,
        val direction: TaskScrollDirection = TaskScrollDirection.Down,
        val distanceRatio: Float = 0.7f,
        val settleDelayMs: Long = 250,
        val findFirstScrollableChild: Boolean = true,
        val retry: TaskRetry = TaskRetry.None,
        val strict: Boolean = false,
    ) : UiAction

    /**
     * Bounded scroll loop. Scrolls repeatedly until a termination condition fires.
     * Always applies safety caps - a scroll loop with no bound is unsafe.
     *
     * Termination conditions (in priority order):
     * 1. [maxScrolls] cap reached
     * 2. [maxDurationMs] cap reached
     * 3. Edge detected (leading-child signature unchanged across successive scrolls)
     * 4. No position change across [noPositionChangeThreshold] consecutive scrolls
     *
     * Returns a [TaskScrollUntilResult] with the number of scrolls executed
     * and the reason termination occurred.
     */
    data class ScrollUntil(
        override val id: String,
        val matcher: NodeMatcher? = null,
        val container: NodeMatcher? = null,
        val clickTypes: UiTreeClickTypes = UiTreeClickTypes.Default,
        val direction: TaskScrollDirection = TaskScrollDirection.Down,
        val distanceRatio: Float = 0.7f,
        val settleDelayMs: Long = 250,
        val maxScrolls: Int = 20,
        val maxDurationMs: Long = 10_000,
        val noPositionChangeThreshold: Int = 3,
        val findFirstScrollableChild: Boolean = true,
        val clickAfter: Boolean = false,
        val strict: Boolean = false,
    ) : UiAction

    data class ReadText(
        override val id: String,
        val matcher: NodeMatcher,
        val retry: TaskRetry = TaskRetryPresets.UiReadiness,
        val validator: UiTextValidator? = null,
        val validatorPattern: String? = null,
        val all: Boolean = false,
        val container: NodeMatcher? = null,
        val strict: Boolean = false,
    ) : UiAction

    data class QueryUi(
        override val id: String,
        val matcher: NodeMatcher? = null,
        val visibility: String = "on_screen",
        val limit: Int = 100,
    ) : UiAction

    data class SnapshotUi(
        override val id: String,
        val retry: TaskRetry = TaskRetryPresets.UiReadiness,
    ) : UiAction

    data class ShowToast(
        override val id: String,
        val text: String,
        val duration: String = "short",
    ) : UiAction

    data class CancelToast(
        override val id: String,
    ) : UiAction

    data class SetOnScreenLog(
        override val id: String,
        val spec: OnScreenLogSpec,
    ) : UiAction

    data class ClearOnScreenLog(
        override val id: String,
    ) : UiAction

    data class StartRecording(
        override val id: String,
        val sessionId: String? = null,
    ) : UiAction

    data class StopRecording(
        override val id: String,
        val sessionId: String? = null,
    ) : UiAction

    data class DoctorPing(
        override val id: String,
        val retry: TaskRetry = TaskRetry.None,
    ) : UiAction

    data class TakeScreenshot(
        override val id: String,
        val retry: TaskRetry = TaskRetry.None,
    ) : UiAction

    data class EnterText(
        override val id: String,
        val matcher: NodeMatcher,
        val text: String,
        val submit: Boolean = false,
        val clear: Boolean = false,
        val retry: TaskRetry = TaskRetryPresets.UiReadiness,
        val strict: Boolean = false,
        val container: NodeMatcher? = null,
    ) : UiAction

    data class Sleep(
        override val id: String,
        val durationMs: Long,
        val retry: TaskRetry = TaskRetry.None,
    ) : UiAction

    data class PressKey(
        override val id: String,
        val key: UiSystemKey,
    ) : UiAction

    data class WaitForNavigation(
        override val id: String,
        val expectedPackage: String? = null,
        val expectedNode: NodeMatcher? = null,
        val timeoutMs: Long,
    ) : UiAction

    data class ReadKeyValuePair(
        override val id: String,
        val labelMatcher: NodeMatcher,
        val retry: TaskRetry = TaskRetryPresets.UiReadiness,
    ) : UiAction
}

enum class UiSnapshotActualFormat(
    val wireValue: String,
) {
    HierarchyXml("hierarchy_xml"),
}

data class UiSnapshotResult(
    val actualFormat: UiSnapshotActualFormat,
    val hierarchyXml: String? = null,
    val foregroundPackage: String? = null,
    val hasOverlay: Boolean = false,
    val overlayPackage: String? = null,
    val windowCount: Int? = null,
    val operatorOverlayVisible: Boolean = false,
)

enum class UiTextValidator {
    Temperature,
    Version,
    Regex,
}

enum class UiSystemKey {
    BACK,
    HOME,
    RECENTS;

    companion object {
        fun fromWire(value: String): UiSystemKey =
            when (value.lowercase()) {
                "back" -> BACK
                "home" -> HOME
                "recents" -> RECENTS
                else -> error("unsupported key: $value")
            }
    }
}

data class UiActionPlan(
    val commandId: String,
    val taskId: String,
    val source: String,
    val actions: List<UiAction>,
)

data class UiActionStepResult(
    val id: String,
    val actionType: String,
    val success: Boolean = true,
    val data: Map<String, String> = emptyMap(),
)

data class UiActionExecutionResult(
    val commandId: String,
    val taskId: String,
    val stepResults: List<UiActionStepResult>,
    val errorCode: String? = null,
    val error: String? = null,
)

fun List<UiAction>.isBackgroundObservation(): Boolean = isNotEmpty() && all {
    it is UiAction.NotificationMedia && it.type in setOf("list_notifications", "list_media_sessions", "get_media_status", "observe_media")
}

/** Whole validated executions that need neither accessibility nor an awake/unlocked screen. */
fun List<UiAction>.isBackgroundServiceExecution(): Boolean = isNotEmpty() && all {
    it is UiAction.NotificationMedia && it.type in setOf(
        "list_notifications", "list_media_sessions", "get_media_status", "observe_media", "media_pause", "media_play", "media_seek",
    )
}
