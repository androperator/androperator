package androperator.operator.recording

import action.buildconfig.BuildConfig
import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.util.Log
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androperator.accessibilityservice.toUiAutomatorHierarchyDump
import java.util.Locale

interface RecordingEventFilter {
    fun onAccessibilityEvent(
        service: AccessibilityService,
        event: AccessibilityEvent?,
    )

    fun onKeyEvent(
        service: AccessibilityService,
        event: KeyEvent,
    )
}

class RecordingEventFilterDefault(
    private val recordingManager: RecordingEventSink,
    private val buildConfig: BuildConfig,
) : RecordingEventFilter {
    override fun onAccessibilityEvent(
        service: AccessibilityService,
        event: AccessibilityEvent?,
    ) {
        if (event == null || !recordingManager.isRecordingActive()) {
            return
        }

        val packageName = event.packageName?.toString()?.takeIf { it.isNotBlank() }
        if (isSelfEventPackage(packageName)) {
            return
        }

        when (event.eventType) {
            AccessibilityEvent.TYPE_VIEW_CLICKED -> enqueueClickEvent(service, event, packageName.orEmpty())
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> enqueueWindowChangeEvent(service, event, packageName.orEmpty())
            AccessibilityEvent.TYPE_VIEW_SCROLLED -> enqueueScrollEvent(event, packageName.orEmpty())
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> enqueueTextChangeEvent(event, packageName.orEmpty())
        }
    }

    override fun onKeyEvent(
        service: AccessibilityService,
        event: KeyEvent,
    ) {
        if (!recordingManager.isRecordingActive()) {
            return
        }
        if (event.keyCode != KeyEvent.KEYCODE_BACK || event.action != KeyEvent.ACTION_UP) {
            return
        }

        val snapshot = captureSnapshot(service, eventType = "press_key")
        recordingManager.enqueueEvent { seq ->
            RecordingPressKeyEvent(
                ts = nowEpochMs(),
                seq = seq,
                key = "back",
                snapshot = snapshot.snapshot,
            )
        }
    }

    private fun enqueueWindowChangeEvent(
        service: AccessibilityService,
        event: AccessibilityEvent,
        packageName: String,
    ) {
        val snapshot = captureSnapshot(service, eventType = "window_change")
        val title =
            firstNonBlank(
                event.contentDescription?.toString(),
                event.text?.firstOrNull()?.toString(),
            )

        recordingManager.enqueueEvent { seq ->
            RecordingWindowChangeEvent(
                ts = nowEpochMs(),
                seq = seq,
                packageName = packageName,
                className = event.className?.toString()?.takeIf { it.isNotBlank() },
                title = title,
                snapshot = snapshot.snapshot,
            )
        }
    }

    private fun enqueueClickEvent(
        service: AccessibilityService,
        event: AccessibilityEvent,
        packageName: String,
    ) {
        val snapshot = captureSnapshot(service, eventType = "click")
        val details = extractNodeDetails(event)

        recordingManager.enqueueEvent { seq ->
            RecordingClickEvent(
                ts = nowEpochMs(),
                seq = seq,
                packageName = packageName,
                resourceId = details.resourceId,
                text = firstNonBlank(details.text, event.text?.firstOrNull()?.toString()),
                contentDesc = firstNonBlank(details.contentDescription, event.contentDescription?.toString()),
                bounds = details.bounds,
                snapshot = snapshot.snapshot,
            )
        }
    }

    private fun enqueueScrollEvent(
        event: AccessibilityEvent,
        packageName: String,
    ) {
        recordingManager.enqueueEvent { seq ->
            RecordingScrollEvent(
                ts = nowEpochMs(),
                seq = seq,
                packageName = packageName,
                resourceId = null,
                scrollX = event.scrollX,
                scrollY = event.scrollY,
                maxScrollX = event.maxScrollX,
                maxScrollY = event.maxScrollY,
                snapshot = null,
            )
        }
    }

    private fun enqueueTextChangeEvent(
        event: AccessibilityEvent,
        packageName: String,
    ) {
        val textValue =
            event.text
                ?.joinToString(separator = "")
                ?.takeIf { it.isNotBlank() }
                ?: ""

        recordingManager.enqueueEvent { seq ->
            RecordingTextChangeEvent(
                ts = nowEpochMs(),
                seq = seq,
                packageName = packageName,
                resourceId = null,
                text = textValue,
                snapshot = null,
            )
        }
    }

    private fun captureSnapshot(
        service: AccessibilityService,
        eventType: String,
    ): RecordingSnapshotResult {
        val rootStartNs = nowElapsedNanos()
        val root = service.rootInActiveWindow
        val rootUs = nanosToMicros(nowElapsedNanos() - rootStartNs)
        if (root == null) {
            Log.w(LOG_TAG, "SNAPSHOT_NULL type=$eventType reason=root_null")
            maybeLogTiming(eventType = eventType, rootUs = rootUs, serializeUs = 0.0, totalUs = rootUs)
            return RecordingSnapshotResult(snapshot = null, rootUs = rootUs, serializeUs = 0.0)
        }

        val serializeStartNs = nowElapsedNanos()
        val snapshot =
            try {
                root.toUiAutomatorHierarchyDump(rotation = resolveRotation(service))
            } finally {
                @Suppress("DEPRECATION")
                root.recycle()
            }
        val serializeUs = nanosToMicros(nowElapsedNanos() - serializeStartNs)
        maybeLogTiming(
            eventType = eventType,
            rootUs = rootUs,
            serializeUs = serializeUs,
            totalUs = rootUs + serializeUs,
        )
        return RecordingSnapshotResult(
            snapshot = snapshot,
            rootUs = rootUs,
            serializeUs = serializeUs,
        )
    }

    private fun maybeLogTiming(
        eventType: String,
        rootUs: Double,
        serializeUs: Double,
        totalUs: Double,
    ) {
        if (!buildConfig.debug) {
            return
        }
        Log.i(
            DIAG_TAG,
            "SNAPSHOT_TIMING type=$eventType rootUs=${format(rootUs)} serializeUs=${format(serializeUs)} totalUs=${format(totalUs)}",
        )
    }

    private fun resolveRotation(service: AccessibilityService): Int =
        try {
            service.display?.rotation ?: 0
        } catch (_: Exception) {
            0
        }

    private fun isSelfEventPackage(packageName: String?): Boolean =
        packageName == OPERATOR_PACKAGE || packageName == OPERATOR_DEV_PACKAGE

    private fun extractNodeDetails(event: AccessibilityEvent): EventNodeDetails {
        var source: AccessibilityNodeInfo? = null
        return try {
            source = event.source
            val bounds = Rect()
            source?.getBoundsInScreen(bounds)
            EventNodeDetails(
                resourceId = source?.viewIdResourceName?.takeIf { it.isNotBlank() },
                text = source?.text?.toString()?.takeIf { it.isNotBlank() },
                contentDescription = source?.contentDescription?.toString()?.takeIf { it.isNotBlank() },
                bounds =
                    if (bounds.isEmpty) {
                        RecordingBounds.Zero
                    } else {
                        RecordingBounds(
                            left = bounds.left,
                            top = bounds.top,
                            right = bounds.right,
                            bottom = bounds.bottom,
                        )
                    },
            )
        } finally {
            @Suppress("DEPRECATION")
            source?.recycle()
        }
    }

    private fun firstNonBlank(vararg candidates: String?): String? =
        candidates.firstOrNull { !it.isNullOrBlank() }?.trim()

    private fun format(value: Double): String = String.format(Locale.US, "%.1f", value)

    private data class EventNodeDetails(
        val resourceId: String?,
        val text: String?,
        val contentDescription: String?,
        val bounds: RecordingBounds,
    )

    companion object {
        private const val LOG_TAG = "RecordingRuntime"
        private const val DIAG_TAG = "RecordingDiag"
        private const val OPERATOR_PACKAGE = "com.androperator.operator"
        private const val OPERATOR_DEV_PACKAGE = "com.androperator.operator.dev"
    }
}
