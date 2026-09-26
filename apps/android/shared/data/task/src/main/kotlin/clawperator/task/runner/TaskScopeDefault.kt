package clawperator.task.runner

import action.log.Log
import action.system.model.ApplicationId
import action.time.getCurrentTimeMillis
import android.os.SystemClock
import android.util.Log as AndroidLog
import clawperator.app.close.AppCloseManager
import clawperator.apps.AppsRepository
import clawperator.trigger.TriggerManager
import clawperator.uitree.UiNode
import clawperator.uitree.UiTreeFilterer
import clawperator.uitree.UiTreeFormatter
import clawperator.uitree.UiTreeInspector
import clawperator.urlnavigator.UrlNavigator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlin.random.Random
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

class TaskScopeDefault(
    private val appsRepository: AppsRepository,
    private val triggerManager: TriggerManager,
    private val appCloseManager: AppCloseManager,
    private val uiTreeInspector: UiTreeInspector,
    private val uiTreeFilterer: UiTreeFilterer,
    private val uiTreeFormatter: UiTreeFormatter,
    private val taskUiScope: TaskUiScope,
    private val urlNavigator: UrlNavigator,
    private val coroutineScopeIo: CoroutineScope,
) : TaskScope {
    companion object {
        private const val TAG = "[TaskScope]"
        private const val SNAPSHOT_TIMING_LOG_TAG = "ClawpSnapshotTiming"
    }

    /**
     * Helper function to convert values to String for payload maps.
     * Drops null values to keep payloads clean.
     */
    private fun payload(vararg pairs: Pair<String, Any?>): Map<String, String> =
        pairs
            .mapNotNull { (key, value) ->
                value?.let { key to it.toString() }
            }.toMap()

    /**
     * Inline utility to measure timing around an operation and return both result and elapsed milliseconds.
     */
    private suspend inline fun <T> withStageTiming(
        crossinline block: suspend () -> T,
    ): Pair<T, Long> {
        val startTime = getCurrentTimeMillis()
        val result = block()
        val elapsedMs = getCurrentTimeMillis() - startTime
        return result to elapsedMs
    }

    private fun isSnapshotTimingEnabled(): Boolean =
        try {
            AndroidLog.isLoggable(SNAPSHOT_TIMING_LOG_TAG, AndroidLog.DEBUG)
        } catch (_: RuntimeException) {
            false
        }

    private suspend inline fun <T> withRetry(
        retry: TaskRetry,
        stageId: String,
        stageLabel: String,
        crossinline successPayload: (T, Long, Int) -> Map<String, String> = { _, elapsedMs, attempt ->
            payload("elapsed_ms" to elapsedMs, "attempt" to attempt)
        },
        crossinline failurePayload: (Throwable, Int) -> Map<String, String> = { throwable, attempt ->
            payload("attempt" to attempt)
        },
        crossinline op: suspend () -> T,
    ): T {
        val sink = currentTaskStatus()
        sink.emit(TaskEvent.StageStart(stageId, stageLabel))

        var attempt = 1
        var delayNext = retry.initialDelay
        val maxDelay = retry.maxDelay.coerceAtLeast(retry.initialDelay)
        val stageStartTime = getCurrentTimeMillis()

        while (true) {
            try {
                val (result, operationElapsedMs) = withStageTiming { op() }
                val totalElapsedMs = getCurrentTimeMillis() - stageStartTime
                val payload = successPayload(result, totalElapsedMs, attempt)
                sink.emit(TaskEvent.StageSuccess(stageId, payload))
                return result
            } catch (t: Throwable) {
                if (t is kotlinx.coroutines.CancellationException) throw t
                if (attempt >= retry.maxAttempts) {
                    val failureData = failurePayload(t, attempt)
                    val reason =
                        if (failureData.containsKey("reason_code")) {
                            "${failureData["reason_code"]}: ${t.message ?: "failed"}"
                        } else {
                            t.message ?: "failed"
                        }
                    sink.emit(TaskEvent.StageFailure(stageId, reason, t))
                    // Emit failure context as a log event for easy grepping
                    if (failureData.isNotEmpty()) {
                        sink.emit(TaskEvent.Log("StageFailure context: ${failureData.entries.joinToString { "${it.key}=${it.value}" }}"))
                    }
                    throw t
                }

                val jitter = delayNext * retry.jitterRatio
                val min = (delayNext - jitter).coerceAtLeast(Duration.ZERO)
                val max = delayNext + jitter
                val sleep =
                    if (retry.jitterRatio > 0.0) {
                        val minMs = min.inWholeMilliseconds
                        val maxMs = max.inWholeMilliseconds
                        if (minMs < 0 || minMs > maxMs) {
                            // Fallback to delayNext if bounds are invalid
                            delayNext
                        } else {
                            Random.nextLong(minMs, maxMs + 1).milliseconds
                        }
                    } else {
                        delayNext
                    }

                sink.emit(TaskEvent.RetryScheduled(stageId, attempt, retry.maxAttempts, sleep.inWholeMilliseconds))
                Log.d("$TAG attempt $attempt failed: ${t.message}; retrying in ${sleep.inWholeMilliseconds}ms")
                delay(sleep)

                delayNext = (delayNext * retry.backoffMultiplier).coerceAtMost(maxDelay)
                attempt++
            }
        }
    }

    override suspend fun openApp(
        applicationId: ApplicationId,
        retry: TaskRetry,
    ) = withRetry(
        retry = retry,
        stageId = "openApp:$applicationId",
        stageLabel = "Opening $applicationId",
        successPayload = { _, elapsedMs, attempt ->
            payload(
                "stage_id" to "openApp:$applicationId",
                "application_id" to applicationId,
                "launch_method" to "shortcut", // Default to shortcut for now
                "cold_start" to "unknown", // Best-effort detection not implemented yet
                "elapsed_ms" to elapsedMs,
                "attempt" to attempt,
            )
        },
        failurePayload = { throwable, attempt ->
            // TODO: Replace string-based detection with typed exceptions (NodeNotFoundException, etc.)
            val reasonCode =
                when {
                    throwable.message?.contains("No app found") == true -> "app_not_found"
                    // Conservative: avoid brittle substring checks
                    else -> "unknown"
                }
            payload(
                "application_id" to applicationId,
                "reason_code" to reasonCode,
                "attempt" to attempt,
            )
        },
    ) {
        val triggerShortcut =
            appsRepository.findTriggerShortcut(applicationId).first()
                ?: throw IllegalStateException("No app found with applicationId=$applicationId")

        Log.d("$TAG Opening app: $applicationId")
        triggerManager.trigger(triggerShortcut.triggerEvent)
        Unit
    }

    override suspend fun openUri(
        uri: String,
        retry: TaskRetry,
    ) = withRetry(
        retry = retry,
        stageId = "openUri:$uri",
        stageLabel = "Opening URI: $uri",
        successPayload = { _, elapsedMs, attempt ->
            payload(
                "stage_id" to "openUri:$uri",
                "uri" to uri,
                "elapsed_ms" to elapsedMs,
                "attempt" to attempt,
            )
        },
        failurePayload = { throwable, attempt ->
            val reasonCode =
                when {
                    throwable.message?.contains("URI_NOT_HANDLED") == true -> "uri_not_handled"
                    else -> "unknown"
                }
            payload(
                "uri" to uri,
                "reason_code" to reasonCode,
                "attempt" to attempt,
            )
        },
    ) {
        Log.d("$TAG Opening URI: $uri")
        val success = urlNavigator.toUri(uri)
        if (!success) {
            throw IllegalStateException("URI_NOT_HANDLED: No application found to handle uri=$uri")
        }
        Unit
    }

    override suspend fun pause(
        duration: Duration,
        retry: TaskRetry,
    ) = withRetry(
        retry = retry,
        stageId = "pause",
        stageLabel = "Pausing for ${duration.inWholeMilliseconds}ms",
        successPayload = { _, elapsedMs, attempt ->
            payload(
                "stage_id" to "pause",
                "requested_ms" to duration.inWholeMilliseconds,
                "elapsed_ms" to elapsedMs,
                "attempt" to attempt,
            )
        },
    ) {
        Log.d("$TAG Pausing for ${duration.inWholeMilliseconds}ms...")
        delay(duration)
        Log.d("$TAG Paused for ${duration.inWholeMilliseconds}ms")
        Unit
    }

    override suspend fun logUiTree(
        retry: TaskRetry,
    ): UiSnapshotResult {
        val sink = currentTaskStatus()
        sink.emit(TaskEvent.StageStart("logUiTree", "Logging UI tree"))

        var attempt = 1
        var delayNext = retry.initialDelay
        val maxDelay = retry.maxDelay.coerceAtLeast(retry.initialDelay)
        val stageStartTime = getCurrentTimeMillis()

        while (true) {
            try {
                Log.d("$TAG Logging UI tree")
                val snapshotTimingEnabled = isSnapshotTimingEnabled()
                val snapshotStartNs = if (snapshotTimingEnabled) SystemClock.elapsedRealtimeNanos() else 0L
                val hierarchyDump = uiTreeInspector.getCurrentUiHierarchyDump()
                    ?: throw QueryHierarchyUnavailableException(
                        uiTreeInspector.getUnavailableHierarchyDiagnostics(), "SNAPSHOT_HIERARCHY_UNAVAILABLE",
                    )
                val hierarchyReadyNs = if (snapshotTimingEnabled) SystemClock.elapsedRealtimeNanos() else 0L
                val commandId = currentTaskCommandId() ?: "unknown"
                Log.d("$TAG UI Hierarchy [commandId=$commandId]:\n$hierarchyDump")
                val hierarchyLoggedNs = if (snapshotTimingEnabled) SystemClock.elapsedRealtimeNanos() else 0L
                val nodeCount = countNodesInHierarchyDump(hierarchyDump)
                val nodeCountReadyNs = if (snapshotTimingEnabled) SystemClock.elapsedRealtimeNanos() else 0L
                val maxDepth = maxDepthInHierarchyDump(hierarchyDump)
                val maxDepthReadyNs = if (snapshotTimingEnabled) SystemClock.elapsedRealtimeNanos() else 0L
                val actualFormat = UiSnapshotActualFormat.HierarchyXml
                val windowMetadata = uiTreeInspector.getCurrentWindowMetadata()
                if (snapshotTimingEnabled) {
                    val metadataReadyNs = SystemClock.elapsedRealtimeNanos()
                    AndroidLog.i(
                        SNAPSHOT_TIMING_LOG_TAG,
                        "[SnapshotTiming] commandId=$commandId hierarchyBytes=${hierarchyDump.encodeToByteArray().size} " +
                            "hierarchyBuildUs=${(hierarchyReadyNs - snapshotStartNs) / 1_000} " +
                            "logCallUs=${(hierarchyLoggedNs - hierarchyReadyNs) / 1_000} " +
                            "nodeCountUs=${(nodeCountReadyNs - hierarchyLoggedNs) / 1_000} " +
                            "maxDepthUs=${(maxDepthReadyNs - nodeCountReadyNs) / 1_000} " +
                            "windowMetadataUs=${(metadataReadyNs - maxDepthReadyNs) / 1_000} " +
                            "metadataAndStatsUs=${(metadataReadyNs - hierarchyLoggedNs) / 1_000} " +
                            "operatorSnapshotUs=${(metadataReadyNs - snapshotStartNs) / 1_000}",
                    )
                }

                val totalElapsedMs = getCurrentTimeMillis() - stageStartTime

                val successPayload =
                    payload(
                        "stage_id" to "logUiTree",
                        "node_count" to nodeCount,
                        "max_depth" to maxDepth,
                        "actual_format" to actualFormat.wireValue,
                        "foreground_package" to windowMetadata?.foregroundPackage,
                        "has_overlay" to windowMetadata?.hasOverlay,
                        "overlay_package" to windowMetadata?.overlayPackage,
                        "window_count" to windowMetadata?.windowCount,
                        "operator_overlay_visible" to windowMetadata?.operatorOverlayVisible,
                        "truncated" to "false", // TODO: Implement truncation detection
                        "elapsed_ms" to totalElapsedMs,
                        "attempt" to attempt,
                    )
                sink.emit(TaskEvent.StageSuccess("logUiTree", successPayload))
                return UiSnapshotResult(
                    actualFormat = actualFormat,
                    foregroundPackage = windowMetadata?.foregroundPackage,
                    hasOverlay = windowMetadata?.hasOverlay ?: false,
                    overlayPackage = windowMetadata?.overlayPackage,
                    windowCount = windowMetadata?.windowCount,
                    operatorOverlayVisible = windowMetadata?.operatorOverlayVisible ?: false,
                )
            } catch (t: Throwable) {
                if (t is kotlinx.coroutines.CancellationException) throw t
                if (attempt >= retry.maxAttempts) {
                    sink.emit(TaskEvent.StageFailure("logUiTree", t.message ?: "failed", t))
                    throw t
                }

                val jitter = delayNext * retry.jitterRatio
                val min = (delayNext - jitter).coerceAtLeast(Duration.ZERO)
                val max = delayNext + jitter
                val sleep =
                    if (retry.jitterRatio > 0.0) {
                        val minMs = min.inWholeMilliseconds
                        val maxMs = max.inWholeMilliseconds
                        if (minMs < 0 || minMs > maxMs) {
                            delayNext
                        } else {
                            Random.nextLong(minMs, maxMs + 1).milliseconds
                        }
                    } else {
                        delayNext
                    }

                sink.emit(TaskEvent.RetryScheduled("logUiTree", attempt, retry.maxAttempts, sleep.inWholeMilliseconds))
                Log.d("$TAG attempt $attempt failed: ${t.message}; retrying in ${sleep.inWholeMilliseconds}ms")
                delay(sleep)

                delayNext = (delayNext * retry.backoffMultiplier).coerceAtMost(maxDelay)
                attempt++
            }
        }
    }

    override suspend fun closeApp(
        applicationId: ApplicationId,
        retry: TaskRetry,
    ) = withRetry(
        retry = retry,
        stageId = "closeApp:$applicationId",
        stageLabel = "Closing $applicationId",
        successPayload = { _, elapsedMs, attempt ->
            payload(
                "stage_id" to "closeApp:$applicationId",
                "application_id" to applicationId,
                "elapsed_ms" to elapsedMs,
                "attempt" to attempt,
            )
        },
        failurePayload = { _, attempt ->
            payload(
                "application_id" to applicationId,
                "attempt" to attempt,
            )
        },
    ) {
        Log.d("$TAG Closing app: $applicationId")
        appCloseManager.closeFirstAppInRecents(applicationId)
        Unit
    }

    private fun countNodes(node: UiNode): Int =
        1 + node.children.sumOf { countNodes(it) }

    private fun calculateMaxDepth(node: UiNode, currentDepth: Int = 0): Int {
        if (node.children.isEmpty()) return currentDepth
        return node.children.maxOf { calculateMaxDepth(it, currentDepth + 1) }
    }

    private fun countNodesInHierarchyDump(hierarchyDump: String): Int = "<node ".toRegex().findAll(hierarchyDump).count()

    private fun maxDepthInHierarchyDump(hierarchyDump: String): Int {
        val tokenRegex = Regex("</?node\b[^>]*?/?>")
        var depth = 0
        var maxDepth = 0
        tokenRegex.findAll(hierarchyDump).forEach { match ->
            val token = match.value
            when {
                token.startsWith("</node") -> {
                    if (depth > 0) depth--
                }
                token.endsWith("/>") -> {
                    // Self-closing node contributes at the current open-parent depth.
                    val nodeDepth = depth
                    if (nodeDepth > maxDepth) maxDepth = nodeDepth
                }
                else -> {
                    // Opening tag contributes at current depth, then increases nesting for children.
                    val nodeDepth = depth
                    if (nodeDepth > maxDepth) maxDepth = nodeDepth
                    depth++
                }
            }
        }
        return maxDepth
    }

    override suspend fun waitForNavigation(
        expectedPackage: String?,
        expectedNode: NodeMatcher?,
        timeoutMs: Long,
        allowAlreadyForeground: Boolean,
    ): WaitForNavigationResult {
        val startTime = getCurrentTimeMillis()
        var lastPackage: String? = null
        val initialPackage = uiTreeInspector.getCurrentWindowMetadata()?.foregroundPackage
        var observedDifferentPackage = false
        val pollDelay = 200.milliseconds

        while (true) {
            val elapsedMs = getCurrentTimeMillis() - startTime
            if (elapsedMs > timeoutMs) {
                return WaitForNavigationResult(
                    success = false,
                    lastPackage = lastPackage,
                    elapsedMs = elapsedMs,
                )
            }

            val windowMetadata = uiTreeInspector.getCurrentWindowMetadata()
            lastPackage = windowMetadata?.foregroundPackage
            if (initialPackage != null && lastPackage != null && lastPackage != initialPackage) {
                observedDifferentPackage = true
            }

            if (shouldSatisfyExpectedPackage(
                    expectedPackage = expectedPackage,
                    initialPackage = initialPackage,
                    currentPackage = lastPackage,
                    observedDifferentPackage = observedDifferentPackage,
                    allowAlreadyForeground = allowAlreadyForeground,
                )
            ) {
                return WaitForNavigationResult(
                    success = true,
                    lastPackage = lastPackage,
                    elapsedMs = getCurrentTimeMillis() - startTime,
                )
            }

            if (expectedNode != null) {
                try {
                    taskUiScope.waitForNode(expectedNode, TaskRetry.None)
                    return WaitForNavigationResult(
                        success = true,
                        lastPackage = lastPackage,
                        elapsedMs = getCurrentTimeMillis() - startTime,
                    )
                } catch (_: IllegalStateException) {
                    // Not yet visible
                }
            }

            delay(pollDelay)
        }
    }

    override suspend fun <T> ui(block: suspend TaskUiScope.() -> T): T {
        Log.d("$TAG Executing UI operations")
        val result = taskUiScope.block()
        Log.d("$TAG UI operations completed")
        return result
    }
}

private fun shouldSatisfyExpectedPackage(
    expectedPackage: String?,
    initialPackage: String?,
    currentPackage: String?,
    observedDifferentPackage: Boolean,
    allowAlreadyForeground: Boolean,
): Boolean {
    if (expectedPackage == null || currentPackage != expectedPackage) {
        return false
    }
    if (allowAlreadyForeground) {
        return true
    }
    // If initial package metadata was unavailable we cannot confirm a transition
    // occurred; require observing a package change as evidence.
    if (initialPackage == null) {
        return observedDifferentPackage
    }
    return initialPackage != expectedPackage || observedDifferentPackage
}
