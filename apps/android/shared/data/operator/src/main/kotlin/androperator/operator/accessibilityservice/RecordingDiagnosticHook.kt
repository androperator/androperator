package androperator.operator.accessibilityservice

import android.accessibilityservice.AccessibilityService
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androperator.accessibilityservice.toUiAutomatorHierarchyDump
import java.util.Locale

internal class RecordingDiagnosticHook {
    private val totalEventCounts = linkedMapOf<String, Int>()
    private val windowEventCounts = linkedMapOf<String, Int>()
    private val rootStats = linkedMapOf<String, TimingStats>()
    private val handlerStats = linkedMapOf<String, TimingStats>()
    private val clickCorrectness = ClickCorrectnessStats()
    private var windowStartElapsedMs = SystemClock.elapsedRealtime()

    fun onServiceConnected() {
        log("HOOK_READY debug instrumentation enabled")
    }

    fun onServiceDestroyed() {
        maybeLogWindowSummary(force = true)
        logAggregateSummary(reason = "service_destroyed")
    }

    fun onAccessibilityEvent(
        service: AccessibilityService,
        event: AccessibilityEvent?,
    ) {
        if (event == null) {
            return
        }

        val startedAtNs = SystemClock.elapsedRealtimeNanos()
        val eventLabel = eventTypeLabel(event.eventType)
        increment(totalEventCounts, eventLabel)
        increment(windowEventCounts, eventLabel)

        when (event.eventType) {
            AccessibilityEvent.TYPE_VIEW_CLICKED -> {
                val clickIdentity = resolveClickIdentity(event)
                captureStepCandidate(
                    service = service,
                    eventLabel = eventLabel,
                    clickIdentity = clickIdentity,
                )
            }

            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                captureStepCandidate(service = service, eventLabel = eventLabel)
            }
        }

        recordHandlerCost(eventLabel, startedAtNs)
    }

    fun onKeyEvent(
        service: AccessibilityService,
        event: KeyEvent,
    ) {
        if (event.keyCode != KeyEvent.KEYCODE_BACK || event.action != KeyEvent.ACTION_UP) {
            return
        }

        val startedAtNs = SystemClock.elapsedRealtimeNanos()
        increment(totalEventCounts, EVENT_BACK_KEY)
        increment(windowEventCounts, EVENT_BACK_KEY)
        captureStepCandidate(service = service, eventLabel = EVENT_BACK_KEY)
        recordHandlerCost(EVENT_BACK_KEY, startedAtNs)
    }

    fun onInterrupt() {
        log("INTERRUPT timestampMs=${SystemClock.elapsedRealtime()}")
    }

    private fun captureStepCandidate(
        service: AccessibilityService,
        eventLabel: String,
        clickIdentity: ClickIdentity? = null,
    ) {
        val rootStartNs = SystemClock.elapsedRealtimeNanos()
        val root = service.rootInActiveWindow
        val rootDurationUs = nanosToMicros(SystemClock.elapsedRealtimeNanos() - rootStartNs)
        rootStats.getOrPut(eventLabel) { TimingStats() }.record(rootDurationUs)

        var correctnessResult: String? = null

        if (root != null) {
            try {
                if (clickIdentity != null) {
                    val rotation = try {
                        service.display?.rotation ?: 0
                    } catch (_: Exception) {
                        0
                    }
                    val snapshot = root.toUiAutomatorHierarchyDump(rotation = rotation)
                    val matchedIdentifier = firstMatchingIdentifier(clickIdentity, snapshot)
                    val pass = matchedIdentifier != null
                    clickCorrectness.record(pass)
                    val identifier =
                        matchedIdentifier ?: clickIdentity.resourceId ?: clickIdentity.text ?: clickIdentity.contentDescription ?: "<missing>"
                    correctnessResult =
                        if (pass) {
                            "CORRECTNESS PASS identifier=${quote(identifier)} field=${clickIdentity.firstNonNullFieldName}"
                        } else {
                            "CORRECTNESS MISS identifier=${quote(identifier)} field=${clickIdentity.firstNonNullFieldName}"
                        }
                }
            } finally {
                root.recycleSafe()
            }
        } else if (clickIdentity != null) {
            clickCorrectness.record(false)
            val identifier = clickIdentity.resourceId ?: clickIdentity.text ?: clickIdentity.contentDescription ?: "<missing>"
            correctnessResult = "CORRECTNESS MISS identifier=${quote(identifier)} field=${clickIdentity.firstNonNullFieldName} reason=root_null"
        }

        val rootSummary = rootStats[eventLabel]!!
        log(
            buildString {
                append("STEP_CANDIDATE type=")
                append(eventLabel)
                append(" rootUs=")
                append(formatUs(rootDurationUs))
                append(" rootStats=")
                append(rootSummary.summary())
                if (correctnessResult != null) {
                    append(' ')
                    append(correctnessResult)
                    append(" correctnessTotals=")
                    append(clickCorrectness.summary())
                }
            },
        )
    }

    private fun recordHandlerCost(
        eventLabel: String,
        startedAtNs: Long,
    ) {
        val handlerDurationUs = nanosToMicros(SystemClock.elapsedRealtimeNanos() - startedAtNs)
        val stats = handlerStats.getOrPut(eventLabel) { TimingStats() }
        stats.record(handlerDurationUs)
        maybeLogWindowSummary(force = false)
        log(
            "HANDLER type=$eventLabel wallUs=${formatUs(handlerDurationUs)} stats=${stats.summary()}",
        )
    }

    private fun maybeLogWindowSummary(force: Boolean) {
        val now = SystemClock.elapsedRealtime()
        val elapsedMs = now - windowStartElapsedMs
        if (!force && elapsedMs < RATE_WINDOW_MS) {
            return
        }
        if (windowEventCounts.isNotEmpty()) {
            val elapsedSeconds = elapsedMs.coerceAtLeast(1).toDouble() / 1000.0
            val rates =
                windowEventCounts.entries.joinToString(separator = ",") { (type, count) ->
                    "$type=${formatRate(count / elapsedSeconds)}/s"
                }
            log("RATE_WINDOW elapsedMs=$elapsedMs rates=$rates")
        }
        windowEventCounts.clear()
        windowStartElapsedMs = now
    }

    private fun logAggregateSummary(reason: String) {
        val totals =
            totalEventCounts.entries.joinToString(separator = ",") { (type, count) ->
                "$type=$count"
            }
        val root =
            rootStats.entries.joinToString(separator = ",") { (type, stats) ->
                "$type=${stats.summary()}"
            }
        val handler =
            handlerStats.entries.joinToString(separator = ",") { (type, stats) ->
                "$type=${stats.summary()}"
            }
        log(
            "AGGREGATE reason=$reason totals=[$totals] root=[$root] handler=[$handler] clickCorrectness=${clickCorrectness.summary()}",
        )
    }

    private fun resolveClickIdentity(event: AccessibilityEvent): ClickIdentity {
        var source: AccessibilityNodeInfo? = null
        return try {
            source = event.source
            ClickIdentity(
                resourceId = source?.viewIdResourceName?.takeIf { it.isNotBlank() },
                text = firstNonBlank(source?.text?.toString(), event.text?.firstOrNull()?.toString()),
                contentDescription = firstNonBlank(source?.contentDescription?.toString(), event.contentDescription?.toString()),
            )
        } finally {
            source.recycleSafe()
        }
    }

    private fun firstMatchingIdentifier(
        clickIdentity: ClickIdentity,
        snapshot: String,
    ): String? {
        val candidates =
            listOfNotNull(
                clickIdentity.resourceId,
                clickIdentity.text,
                clickIdentity.contentDescription,
            )
        return candidates.firstOrNull { candidate ->
            snapshot.contains(candidate) || snapshot.contains(escapeXml(candidate))
        }
    }

    private fun increment(
        counts: MutableMap<String, Int>,
        key: String,
    ) {
        counts[key] = (counts[key] ?: 0) + 1
    }

    private fun nanosToMicros(durationNs: Long): Double = durationNs / 1_000.0

    private fun formatUs(value: Double): String = String.format(Locale.US, "%.1f", value)

    private fun formatRate(value: Double): String = String.format(Locale.US, "%.2f", value)

    private fun firstNonBlank(vararg candidates: String?): String? =
        candidates.firstOrNull { !it.isNullOrBlank() }?.trim()

    private fun quote(value: String): String = "\"" + value.replace("\"", "\\\"") + "\""

    private fun log(message: String) {
        Log.i(LOG_TAG, message)
    }

    private data class ClickIdentity(
        val resourceId: String?,
        val text: String?,
        val contentDescription: String?,
    ) {
        val firstNonNullFieldName: String
            get() =
                when {
                    resourceId != null -> "resourceId"
                    text != null -> "text"
                    contentDescription != null -> "contentDescription"
                    else -> "none"
                }
    }

    private class ClickCorrectnessStats {
        var passes: Int = 0
            private set
        var total: Int = 0
            private set

        fun record(pass: Boolean) {
            total += 1
            if (pass) {
                passes += 1
            }
        }

        fun summary(): String = "$passes/$total"
    }

    private class TimingStats {
        private var count: Int = 0
        private var totalUs: Double = 0.0
        private var minUs: Double = Double.POSITIVE_INFINITY
        private var maxUs: Double = 0.0

        fun record(durationUs: Double) {
            count += 1
            totalUs += durationUs
            if (durationUs < minUs) {
                minUs = durationUs
            }
            if (durationUs > maxUs) {
                maxUs = durationUs
            }
        }

        fun summary(): String {
            if (count == 0) {
                return "count=0"
            }
            val avgUs = totalUs / count
            return String.format(
                Locale.US,
                "count=%d,minUs=%.1f,avgUs=%.1f,maxUs=%.1f",
                count,
                minUs,
                avgUs,
                maxUs,
            )
        }
    }

    companion object {
        private const val EVENT_BACK_KEY = "KEYCODE_BACK"
        private const val LOG_TAG = "RecordingDiag"
        private const val RATE_WINDOW_MS = 1_000L

        private fun eventTypeLabel(eventType: Int): String =
            when (eventType) {
                AccessibilityEvent.TYPE_VIEW_CLICKED -> "TYPE_VIEW_CLICKED"
                AccessibilityEvent.TYPE_VIEW_SCROLLED -> "TYPE_VIEW_SCROLLED"
                AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> "TYPE_VIEW_TEXT_CHANGED"
                AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> "TYPE_WINDOW_STATE_CHANGED"
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> "TYPE_WINDOW_CONTENT_CHANGED"
                AccessibilityEvent.TYPE_VIEW_FOCUSED -> "TYPE_VIEW_FOCUSED"
                else -> "TYPE_$eventType"
            }

        private fun escapeXml(value: String): String =
            buildString(value.length) {
                value.forEach { ch ->
                    when (ch) {
                        '&' -> append("&amp;")
                        '"' -> append("&quot;")
                        '\'' -> append("&apos;")
                        '<' -> append("&lt;")
                        '>' -> append("&gt;")
                        else -> append(ch)
                    }
                }
            }

        private fun AccessibilityNodeInfo?.recycleSafe() {
            if (this == null) {
                return
            }
            try {
                @Suppress("DEPRECATION")
                recycle()
            } catch (_: Exception) {
            }
        }
    }
}
