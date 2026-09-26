package clawperator.task.runner

// Helper function to get current task status from coroutine context
import clawperator.uitree.TextSubmissionOutcome
import action.log.Log
import action.time.getCurrentTimeMillis
import action.math.geometry.Point
import clawperator.uitree.ToggleState
import clawperator.uitree.UiNode
import clawperator.uitree.UiRole
import clawperator.uitree.UiTree
import clawperator.uitree.UiTreeClickTypes
import clawperator.uitree.UiTreeFilterer
import clawperator.uitree.UiTreeFormatter
import clawperator.uitree.UiTreeInspector
import clawperator.uitree.UiTreeManager
import clawperator.uitree.UiTreeTraversal
import clawperator.uitree.inferOnOffState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlin.random.Random
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TimeSource

class TaskUiScopeDefault(
    private val uiTreeInspector: UiTreeInspector,
    private val uiTreeFilterer: UiTreeFilterer,
    private val uiTreeFormatter: UiTreeFormatter,
    private val uiTreeManager: UiTreeManager,
    private val coroutineScopeIo: CoroutineScope,
) : TaskUiScope {
    override suspend fun swipe(start: Point, end: Point, durationMs: Long) {
        require(start.x >= 0 && start.y >= 0 && end.x >= 0 && end.y >= 0) { "swipe coordinates must be non-negative" }
        require(start != end) { "swipe start and end must differ" }
        require(durationMs in 1L..10000L) { "swipe durationMs must be in [1, 10000]" }
        if (!uiTreeManager.swipeAt(start.x, start.y, end.x, end.y, durationMs)) {
            throw UiActionFailure("GESTURE_FAILED", "Swipe could not complete; check display bounds, accessibility service availability, and gesture cancellation")
        }
    }

    override suspend fun queryUi(
        matcher: NodeMatcher?,
        visibility: String,
        limit: Int,
    ): String {
        val raw = uiTreeInspector.getCurrentUiTree()
            ?: throw QueryHierarchyUnavailableException(uiTreeInspector.getUnavailableHierarchyDiagnostics())
        val capturedAt = queryCaptureTimestamp()
        val visible = uiTreeFilterer.filterOnScreenOnly(raw)
        return NodeResolver(visible).query(matcher, visibility, limit, capturedAt = capturedAt)
    }

    companion object {
        private const val TAG = "[TaskUiScope]"
        private const val DEBUG_SCROLL_LOGGING = false // Set to true for detailed scroll debugging
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
     * Creates a stable hash for UI text content to avoid PII leakage.
     */
    private fun hashNodeText(text: String): String {
        // Simple hash for now - could use SHA-1 for better stability across platforms
        return text.hashCode().toString(16).take(8)
    }

    private suspend inline fun <T> withRetry(
        retry: TaskRetry,
        operation: String,
        crossinline successPayload: (T, Long, Int) -> Map<String, String> = { _, elapsedMs, attempt ->
            payload("elapsed_ms" to elapsedMs, "attempt" to attempt)
        },
        crossinline failurePayload: (Throwable, Int) -> Map<String, String> = { _, attempt ->
            payload("attempt" to attempt)
        },
        crossinline op: suspend () -> T,
    ): T {
        val sink = currentTaskStatus()
        sink.emit(TaskEvent.StageStart(operation, operation))

        var attempt = 1
        var delayNext = retry.initialDelay
        val maxDelay = retry.maxDelay.coerceAtLeast(retry.initialDelay)
        val stageStartTime = getCurrentTimeMillis()

        while (true) {
            try {
                val result = op()
                val totalElapsedMs = getCurrentTimeMillis() - stageStartTime
                val payload = successPayload(result, totalElapsedMs, attempt)
                sink.emit(TaskEvent.StageSuccess(operation, payload))
                return result
            } catch (t: Throwable) {
                if (t is kotlinx.coroutines.CancellationException) throw t
                if (t is StrictSelectionException && t.code != "NODE_NOT_FOUND") throw t
                if (attempt >= retry.maxAttempts || kotlin.coroutines.coroutineContext[clawperator.uitree.UiDispatchObservation]?.retryBlocked == true) {
                    Log.e(TAG, "$operation failed after $attempt attempts: ${t.message}")
                    val failureData = failurePayload(t, attempt)
                    val reason =
                        if (failureData.containsKey("reason_code")) {
                            "${failureData["reason_code"]}: ${t.message ?: "failed"}"
                        } else {
                            t.message ?: "failed"
                        }
                    sink.emit(TaskEvent.StageFailure(operation, reason, t))
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

                sink.emit(TaskEvent.RetryScheduled(operation, attempt, retry.maxAttempts, sleep.inWholeMilliseconds))
                Log.d("$TAG $operation attempt $attempt failed: ${t.message}; retrying in ${sleep.inWholeMilliseconds}ms")
                delay(sleep)

                delayNext = (delayNext * retry.backoffMultiplier).coerceAtMost(maxDelay)
                attempt++
            }
        }
    }

    /**
     * Gets the text content of a UI element that matches the specified NodeMatcher criteria and validates it.
     * Retries according to the retry configuration until a matching element is found, text extracted,
     * and the validator function returns true.
     *
     * @param matcher NodeMatcher containing the criteria to match
     * @param retry Retry configuration (defaults to UiReadiness)
     * @param validator Lambda function that validates the text content
     * @return The validated text content of the matching element
     * @throws Exception if no matching element is found, text cannot be extracted, or validation fails after all retries
     */
    override suspend fun getValidatedText(
        matcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
        validator: (String) -> Boolean,
    ): String =
        withRetry(
            retry = retry,
            operation = "getValidatedText($matcher)",
            successPayload = { text, elapsedMs, attempt ->
                payload(
                    "matcher" to matcher.toString(),
                    "validator" to "custom", // Could be improved with validator identification
                    "validated_value" to hashNodeText(text), // Redacted hash
                    "elapsed_ms" to elapsedMs,
                    "attempt" to attempt,
                )
            },
            failurePayload = { throwable, attempt ->
                val failurePoint =
                    when {
                        throwable.message?.contains("not found") == true -> "node_not_found"
                        throwable.message?.contains("no text content") == true -> "text_missing"
                        throwable.message?.contains("Validation failed") == true -> "validation_failed"
                        else -> "unknown"
                    }
                payload(
                    "matcher" to matcher.toString(),
                    "validator" to "custom",
                    "failure_point" to failurePoint,
                    "attempt" to attempt,
                )
            },
        ) {
            Log.d("$TAG Getting validated text for node matching: $matcher")

            val uiTreeRaw =
                uiTreeInspector.getCurrentUiTree()
                    ?: throw QueryHierarchyUnavailableException(uiTreeInspector.getUnavailableHierarchyDiagnostics())

            val uiTree = uiTreeFilterer.filterOnScreenOnly(uiTreeRaw)

            val uiNode =
                actionNodes(matcher, uiTree, strict, null).firstOrNull()
                    ?: throw UiActionFailure("NODE_NOT_FOUND", "No UI node found matching criteria: $matcher")

            val text = uiNode.label
            if (text.isBlank()) {
                throw IllegalStateException("Matching UI node has no text content")
            }

            // Validate the text
            if (!validator(text)) {
                Log.d("$TAG Validation failed for text '$text' from matching node")
                throw IllegalStateException("Validation failed for text '$text' from matching UI node")
            }

            Log.d("$TAG ✅ Validated text: '$text'")
            text
        }

    private suspend fun findNodeByMatcher(
        matcher: NodeMatcher,
        uiTree: UiTree,
    ): UiNode? = findAllNodesByMatcher(matcher, uiTree).firstOrNull()

    private suspend fun findAllNodesByMatcher(
        matcher: NodeMatcher,
        uiTree: UiTree,
    ): List<UiNode> =
        withContext(coroutineScopeIo.coroutineContext) {
            NodeResolver(uiTree).resolve(matcher).map { it.node }
        }

    private suspend fun selectCandidates(
        resolver: NodeResolver,
        candidates: List<NodeResolver.Candidate>,
        strict: Boolean,
        container: Boolean = false,
        allowEmpty: Boolean = false,
        allowMany: Boolean = false,
    ): List<NodeResolver.Candidate> {
        if (strict && ((!allowMany && candidates.size > 1) || (!allowEmpty && candidates.isEmpty()))) {
            val prefix = if (container) "CONTAINER" else "NODE"
            val suffix = if (candidates.isEmpty()) "NOT_FOUND" else "AMBIGUOUS"
            throw StrictSelectionException("${prefix}_$suffix", candidates.size, resolver.encodeMatches(candidates))
        }
        if (!strict && !allowMany && candidates.size > 1) {
            kotlin.coroutines.coroutineContext[SelectionWarnings]?.record(candidates.size, container)
        }
        return candidates
    }

    private suspend fun actionNodes(
        matcher: NodeMatcher,
        tree: UiTree,
        strict: Boolean,
        container: NodeMatcher? = null,
        allowEmpty: Boolean = false,
        allowMany: Boolean = false,
        recordReceipt: Boolean = false,
    ): List<UiNode> {
        val resolver = NodeResolver(tree)
        val scope = container?.let {
            selectCandidates(resolver, resolver.resolve(it), strict, container = true).firstOrNull()
                ?: throw UiActionFailure("CONTAINER_NOT_FOUND", "Container not found for $it")
        }
        val matches = resolver.resolve(matcher).filter { scope == null || it.nodePath.startsWith("${scope.nodePath}.") }
        val selected = selectCandidates(resolver, matches, strict, allowEmpty = allowEmpty, allowMany = allowMany)
        if (recordReceipt) selected.firstOrNull()?.let { kotlin.coroutines.coroutineContext[ActionReceipt]?.selected(tree, it.node, matches.size) }
        return selected.map { it.node }
    }

    private suspend fun scrollNode(
        tree: UiTree,
        container: NodeMatcher?,
        strict: Boolean,
        findChild: Boolean,
        allowMissing: Boolean = false,
        recordReceipt: Boolean = false,
    ): UiNode? {
        val resolver = NodeResolver(tree)
        val scope = container?.let {
            selectCandidates(resolver, resolver.resolve(it), strict, container = true).firstOrNull()
                ?: if (allowMissing && !strict) return null else throw UiActionFailure("CONTAINER_NOT_FOUND", "Container not found for $it")
        }
        if (scope != null && isScrollable(scope.node)) {
            if (recordReceipt) kotlin.coroutines.coroutineContext[ActionReceipt]?.selected(tree, scope.node, resolver.resolve(container).size)
            return scope.node
        }
        if (scope != null && !findChild) throw UiActionFailure("CONTAINER_NOT_SCROLLABLE", "Scrollable container not found for $container")
        val scrollables = resolver.resolve(null).filter {
            isScrollable(it.node) && (scope == null || it.nodePath.startsWith("${scope.nodePath}."))
        }
        if (!strict && scope != null && scrollables.isEmpty() && !allowMissing) {
            throw UiActionFailure("CONTAINER_NOT_SCROLLABLE", "Scrollable container not found for $container")
        }
        val selected = selectCandidates(resolver, scrollables, strict, container = true).firstOrNull()?.node
        if (recordReceipt) selected?.let { kotlin.coroutines.coroutineContext[ActionReceipt]?.selected(tree, it, scrollables.size) }
        return selected
    }

    private suspend fun scrollTarget(
        target: NodeMatcher,
        tree: UiTree,
        container: NodeMatcher?,
        strict: Boolean,
        findChild: Boolean,
        recordReceipt: Boolean = false,
        expectedScope: TaskScrollScope? = null,
    ): UiNode? {
        if (expectedScope == null && !strict && container == null) return actionNodes(target, tree, strict = false, allowEmpty = true, recordReceipt = recordReceipt).firstOrNull()
        // After selection, eligibility changes do not change the target observation scope.
        val selected = if (expectedScope != null) requireScrollScope(expectedScope, tree, strict)
            else scrollNode(tree, container, strict, findChild) ?: return null
        val resolver = NodeResolver(tree)
        val scope = resolver.resolve(null).first { it.node === selected }
        val matches = resolver.resolve(target).filter { it.nodePath.startsWith("${scope.nodePath}.") }
        val selectedTarget = selectCandidates(resolver, matches, strict, allowEmpty = true).firstOrNull()?.node
        if (recordReceipt) selectedTarget?.let { kotlin.coroutines.coroutineContext[ActionReceipt]?.selected(tree, it, matches.size) }
        return selectedTarget
    }

    override suspend fun waitForNode(
        matcher: NodeMatcher,
        retry: TaskRetry,
        timeoutMs: Long?,
        strict: Boolean,
        container: NodeMatcher?,
    ): TaskUiNode {
        val operation: suspend () -> TaskUiNode = {
            withRetry(retry, "waitForNode($matcher)") {
                Log.d("$TAG Waiting for node matching: $matcher")

                val uiTreeRaw =
                    uiTreeInspector.getCurrentUiTree()
                        ?: throw QueryHierarchyUnavailableException(uiTreeInspector.getUnavailableHierarchyDiagnostics())

                val uiTree = uiTreeFilterer.filterOnScreenOnly(uiTreeRaw)

                val uiNode =
                    actionNodes(matcher, uiTree, strict, container).firstOrNull()
                        ?: throw UiActionFailure("NODE_NOT_FOUND", "No UI node found matching criteria: $matcher")

                val taskUiNode =
                    TaskUiNode(
                        resourceId = uiNode.resourceId,
                        label = uiNode.label,
                        contentDescription = uiNode.contentDescription,
                        clickable = uiNode.isClickable,
                        role = uiNode.role.name.lowercase(),
                        bounds = uiNode.bounds,
                        debugPath = uiNode.id.value,
                    )
                Log.d("$TAG Found matching node: $taskUiNode")
                taskUiNode
            }
        }

        return if (timeoutMs != null) {
            kotlinx.coroutines.withTimeoutOrNull(timeoutMs) { operation() }
                ?: throw UiActionFailure("WAIT_TIMEOUT", "Timeout waiting for node matching: $matcher (timeoutMs=$timeoutMs)")
        } else {
            operation()
        }
    }

    override suspend fun readKeyValuePair(
        labelMatcher: NodeMatcher,
        retry: TaskRetry,
    ): Pair<String, String> =
        withRetry(retry, "readKeyValuePair($labelMatcher)") {
            Log.d("$TAG readKeyValuePair: $labelMatcher")

            val uiTreeRaw =
                uiTreeInspector.getCurrentUiTree()
                    ?: throw QueryHierarchyUnavailableException(uiTreeInspector.getUnavailableHierarchyDiagnostics())

            val uiTreeFiltered = uiTreeFilterer.filterOnScreenOnly(uiTreeRaw)
            resolveKeyValuePair(uiTreeFiltered, labelMatcher)
        }

    override suspend fun getText(
        matcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
    ): String =
        withRetry(retry, "getText($matcher)") {
            Log.d("$TAG Getting text for node matching: $matcher")

            val uiTreeRaw =
                uiTreeInspector.getCurrentUiTree()
                    ?: throw QueryHierarchyUnavailableException(uiTreeInspector.getUnavailableHierarchyDiagnostics())

            val uiTree = uiTreeFilterer.filterOnScreenOnly(uiTreeRaw)

            val uiNode =
                actionNodes(matcher, uiTree, strict, null).firstOrNull()
                    ?: throw UiActionFailure("NODE_NOT_FOUND", "No UI node found matching criteria: $matcher")

            val text = uiNode.label
            if (text.isBlank()) {
                throw IllegalStateException("Matching UI node has no text content")
            }

            Log.d("$TAG Got text from matching node: '$text'")
            text
        }

    override suspend fun getAllText(
        matcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
    ): List<String> =
        withRetry(retry, "getAllText($matcher)") {
            Log.d("$TAG Getting all text for nodes matching: $matcher")

            val uiTreeRaw =
                uiTreeInspector.getCurrentUiTree()
                    ?: throw QueryHierarchyUnavailableException(uiTreeInspector.getUnavailableHierarchyDiagnostics())

            val uiTree = uiTreeFilterer.filterOnScreenOnly(uiTreeRaw)

            val uiNodes = actionNodes(matcher, uiTree, strict, allowEmpty = true, allowMany = true)

            val texts = uiNodes.map { it.label }.filter { it.isNotBlank() }

            Log.d("$TAG Got text from ${texts.size} matching nodes")
            texts
        }

    override suspend fun getTextWithinContainer(
        matcher: NodeMatcher,
        containerMatcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
    ): String =
        withRetry(retry, "getTextWithinContainer(matcher=$matcher, container=$containerMatcher)") {
            Log.d("$TAG Getting text for node matching: $matcher within container: $containerMatcher")

            val uiTreeRaw =
                uiTreeInspector.getCurrentUiTree()
                    ?: throw QueryHierarchyUnavailableException(uiTreeInspector.getUnavailableHierarchyDiagnostics())

            val uiTree = uiTreeFilterer.filterOnScreenOnly(uiTreeRaw)

            val uiNode = actionNodes(matcher, uiTree, strict, containerMatcher).firstOrNull()
                ?: throw UiActionFailure("NODE_NOT_FOUND", "No UI node found matching criteria: $matcher")

            val text = uiNode.label
            if (text.isBlank()) {
                throw IllegalStateException("Matching UI node has no text content")
            }

            Log.d("$TAG Got text from matching node within container: '$text'")
            text
        }

    override suspend fun getValidatedTextWithinContainer(
        matcher: NodeMatcher,
        containerMatcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
        validator: (String) -> Boolean,
    ): String =
        withRetry(retry, "getValidatedTextWithinContainer(matcher=$matcher, container=$containerMatcher)") {
            Log.d("$TAG Getting validated text for node matching: $matcher within container: $containerMatcher")

            val uiTreeRaw =
                uiTreeInspector.getCurrentUiTree()
                    ?: throw QueryHierarchyUnavailableException(uiTreeInspector.getUnavailableHierarchyDiagnostics())

            val uiTree = uiTreeFilterer.filterOnScreenOnly(uiTreeRaw)

            val uiNode = actionNodes(matcher, uiTree, strict, containerMatcher).firstOrNull()
                ?: throw UiActionFailure("NODE_NOT_FOUND", "No UI node found matching criteria: $matcher")

            val text = uiNode.label
            if (text.isBlank()) {
                throw IllegalStateException("Matching UI node has no text content")
            }

            // Validate the text
            if (!validator(text)) {
                Log.d("$TAG Validation failed for text '$text' from matching node within container")
                throw IllegalStateException("Validation failed for text '$text' from matching UI node within container")
            }

            Log.d("$TAG Got validated text from matching node within container: '$text'")
            text
        }

    override suspend fun getAllTextWithinContainer(
        matcher: NodeMatcher,
        containerMatcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
    ): List<String> =
        withRetry(retry, "getAllTextWithinContainer(matcher=$matcher, container=$containerMatcher)") {
            Log.d("$TAG Getting all text for nodes matching: $matcher within container: $containerMatcher")

            val uiTreeRaw =
                uiTreeInspector.getCurrentUiTree()
                    ?: throw QueryHierarchyUnavailableException(uiTreeInspector.getUnavailableHierarchyDiagnostics())

            val uiTree = uiTreeFilterer.filterOnScreenOnly(uiTreeRaw)

            val uiNodes = actionNodes(matcher, uiTree, strict, containerMatcher, allowEmpty = true, allowMany = true)

            val texts = uiNodes.map { it.label }.filter { it.isNotBlank() }

            Log.d("$TAG Got text from ${texts.size} matching nodes within container")
            texts
        }

    override suspend fun click(
        matcher: NodeMatcher?,
        coordinate: Point?,
        clickTypes: UiTreeClickTypes,
        retry: TaskRetry,
        strict: Boolean,
        container: NodeMatcher?,
    ) = withRetry(
        retry = retry,
        operation = if (coordinate != null) "click(${coordinate.shortString})" else "click($matcher)",
        successPayload = { _, elapsedMs, attempt ->
            payload(
                "matcher" to matcher?.toString(),
                "coordinate" to coordinate?.shortString,
                "click_type" to clickTypes.toString(),
                "elapsed_ms" to elapsedMs,
                "attempt" to attempt,
            )
        },
        failurePayload = { throwable, attempt ->
            val failurePoint = when (throwable) {
                    is UiActionFailure -> throwable.code
                    is QueryHierarchyUnavailableException -> throwable.code
                    is StrictSelectionException -> throwable.code
                    else -> "ACTION_FAILED"
                }
            payload(
                "matcher" to matcher?.toString(),
                "coordinate" to coordinate?.shortString,
                "failure_point" to failurePoint,
                "attempt" to attempt,
            )
        },
    ) {
        require(coordinate == null || (!strict && container == null)) { "coordinate click cannot use strict or container" }
        if (coordinate != null) {
            Log.d("$TAG Clicking coordinate: ${coordinate.shortString}")
            kotlin.coroutines.coroutineContext[ActionReceipt]?.coordinate(coordinate.x.toDouble(), coordinate.y.toDouble())
            val clickSuccessful = uiTreeManager.clickAt(coordinate.x.toFloat(), coordinate.y.toFloat(), clickTypes)
            if (!clickSuccessful) {
                throw UiActionFailure("GESTURE_FAILED", "Click at coordinate ${coordinate.shortString} failed")
            }
            Log.d("$TAG Successfully clicked coordinate ${coordinate.shortString}")
            return@withRetry Unit
        }

        val targetMatcher = matcher ?: throw IllegalStateException("click requires matcher or coordinate")
        Log.d("$TAG Clicking node matching: $targetMatcher")

        val uiTreeRaw =
            uiTreeInspector.getCurrentUiTree()
                ?: throw QueryHierarchyUnavailableException(uiTreeInspector.getUnavailableHierarchyDiagnostics())

        val uiTree = uiTreeFilterer.filterOnScreenOnly(uiTreeRaw)

        val uiNode =
            actionNodes(targetMatcher, uiTree, strict, container, recordReceipt = true).firstOrNull()
                ?: throw UiActionFailure("NODE_NOT_FOUND", "No UI node found matching criteria: $targetMatcher")

        val clickSuccessful = uiTreeManager.triggerClick(uiNode, clickTypes)
        if (!clickSuccessful) {
            throw UiActionFailure("ACTION_FAILED", "Click on matching UI node failed")
        }

        Log.d("$TAG Successfully clicked matching node")
        Unit
    }

    override suspend fun enterText(
        matcher: NodeMatcher,
        text: String,
        submit: Boolean,
        clear: Boolean,
        retry: TaskRetry,
        strict: Boolean,
        container: NodeMatcher?,
    ) = withRetry(
        retry = retry,
        operation = "enterText($matcher)",
        successPayload = { _, elapsedMs, attempt ->
            payload(
                "matcher" to matcher.toString(),
                "clear" to clear,
                "submit" to submit,
                "text_length" to text.length,
                "elapsed_ms" to elapsedMs,
                "attempt" to attempt,
            )
        },
        failurePayload = { throwable, attempt ->
            val failurePoint = when (throwable) {
                    is UiActionFailure -> throwable.code
                    is QueryHierarchyUnavailableException -> throwable.code
                    is StrictSelectionException -> throwable.code
                    else -> "ACTION_FAILED"
                }
            payload(
                "matcher" to matcher.toString(),
                "clear" to clear,
                "submit" to submit,
                "text_length" to text.length,
                "failure_point" to failurePoint,
                "attempt" to attempt,
            )
        },
    ) {
        Log.d("$TAG Entering text into node matching: $matcher (len=${text.length}, clear=$clear, submit=$submit)")

        val uiTreeRaw =
            uiTreeInspector.getCurrentUiTree()
                ?: throw QueryHierarchyUnavailableException(uiTreeInspector.getUnavailableHierarchyDiagnostics())

        val uiTree = uiTreeFilterer.filterOnScreenOnly(uiTreeRaw)

        val uiNode =
            actionNodes(matcher, uiTree, strict, container, recordReceipt = true).firstOrNull()
                ?: throw UiActionFailure("NODE_NOT_FOUND", "No UI node found matching criteria: $matcher")

        val submission =
            uiTreeManager.setText(
                uiNode = uiNode,
                text = text,
                submit = submit,
                clear = clear,
            )
        if (submission == null) {
            throw UiActionFailure("ACTION_FAILED", "Failed to set text on matching UI node")
        }

        Log.d("$TAG Successfully entered text into matching node")
        submission
    }

    override suspend fun clickScrollTarget(
        target: NodeMatcher,
        container: NodeMatcher?,
        strict: Boolean,
        findFirstScrollableChild: Boolean,
        clickTypes: UiTreeClickTypes,
        retry: TaskRetry,
        scope: TaskScrollScope?,
    ) {
        withRetry(retry, "clickScrollTarget($target)") {
            val tree = currentUiTreeFiltered()
            val node = scrollTarget(target, tree, container, strict, findFirstScrollableChild, recordReceipt = true, expectedScope = scope)
                ?: if (strict) throw StrictSelectionException("NODE_NOT_FOUND", 0, NodeResolver(tree).encodeMatches(emptyList()))
                else throw UiActionFailure("NODE_NOT_FOUND", "No UI node found matching criteria: $target")
            check(uiTreeManager.triggerClick(node, clickTypes)) { "Click on matching UI node failed" }
        }
    }

    override suspend fun scrollUntil(
        target: NodeMatcher,
        container: NodeMatcher?,
        direction: TaskScrollDirection,
        maxSwipes: Int,
        distanceRatio: Float,
        settleDelay: Duration,
        retry: TaskRetry,
        findFirstScrollableChild: Boolean,
        strict: Boolean,
    ): TaskScrollResult = withRetry(retry, "scrollUntil($target)") {
        val result = scrollLoop(target, container, direction, distanceRatio, settleDelay,
            maxSwipes, Duration.INFINITE, 2, findFirstScrollableChild, strict)
        if (result.terminationReason == TaskScrollTerminationReason.TargetFound) {
            val tree = currentUiTreeFiltered()
            val found = scrollTarget(target, tree, container, strict, findFirstScrollableChild, expectedScope = result.scope)
                ?: throw UiActionFailure("NODE_NOT_FOUND", "Target disappeared after scrolling")
            return@withRetry TaskScrollResult.Found(toTaskUiNode(found), result.scope)
        }
        when (result.terminationReason) {
            TaskScrollTerminationReason.ContainerLost -> throw UiActionFailure("CONTAINER_LOST", "Scroll container disappeared")
            TaskScrollTerminationReason.ContainerNotFound -> throw UiActionFailure("CONTAINER_NOT_FOUND", "Scroll container not found")
            TaskScrollTerminationReason.ContainerNotScrollable -> throw UiActionFailure("CONTAINER_NOT_SCROLLABLE", "Container is not scrollable")
            else -> Unit
        }
        TaskScrollResult.NotFoundExhausted
    }

    override suspend fun scrollIntoView(
        target: NodeMatcher,
        container: NodeMatcher?,
        direction: TaskScrollDirection,
        maxSwipes: Int,
        distanceRatio: Float,
        settleDelay: Duration,
        retry: TaskRetry,
        findFirstScrollableChild: Boolean,
        strict: Boolean,
    ): TaskUiNode =
        when (val result = scrollUntil(target, container, direction, maxSwipes, distanceRatio, settleDelay, retry, findFirstScrollableChild, strict)) {
            is TaskScrollResult.Found -> result.node
            TaskScrollResult.NotFoundExhausted -> throw UiActionFailure("NODE_NOT_FOUND", "Target node not found after scrolling: $target")
        }

    override suspend fun scrollOnce(
        container: NodeMatcher?,
        direction: TaskScrollDirection,
        distanceRatio: Float,
        settleDelay: Duration,
        retry: TaskRetry,
        findFirstScrollableChild: Boolean,
        strict: Boolean,
    ): TaskScrollOnceResult = scrollOnceForTarget(container, direction, distanceRatio, settleDelay, retry, findFirstScrollableChild, strict, null).result

    private data class ScrollSearchStep(
        val result: TaskScrollOnceResult,
        val targetFound: Boolean = false,
        val containerIdentified: Boolean = true,
        val scrollable: Boolean = true,
        val dispatched: Boolean = true,
    )

    private suspend fun scrollOnceForTarget(
        container: NodeMatcher?,
        direction: TaskScrollDirection,
        distanceRatio: Float,
        settleDelay: Duration,
        retry: TaskRetry,
        findFirstScrollableChild: Boolean,
        strict: Boolean,
        target: NodeMatcher?,
        expectedContainer: TaskScrollScope? = null,
    ): ScrollSearchStep = withRetry(retry, "scrollOnce(dir=$direction)") {
        require(distanceRatio in 0f..1f) { "distanceRatio must be in [0,1], got $distanceRatio" }
        val tree = currentUiTreeFiltered()
        val selected = if (expectedContainer != null) requireScrollScope(expectedContainer, tree, strict)
            else scrollNode(tree, container, strict, findFirstScrollableChild)
                ?: throw UiActionFailure("CONTAINER_NOT_FOUND", "No scrollable container visible")
        val scope = expectedContainer ?: TaskScrollScope(tree, selected)
        val resolvedContainerId = selected.resourceId
        if (target != null && scrollTarget(target, tree, container, strict, findFirstScrollableChild, expectedScope = scope) != null) {
            return@withRetry ScrollSearchStep(TaskScrollOnceResult(TaskScrollOutcome.Unknown, resolvedContainerId), targetFound = true, dispatched = false)
        }
        if (!isScrollable(selected)) throw UiActionFailure("CONTAINER_NOT_SCROLLABLE", "Original container is no longer scrollable")
        // Record only the resolution actually used for dispatch, never a later target observation.
        if (expectedContainer == null) scrollNode(tree, container, strict, findFirstScrollableChild, recordReceipt = true)
        else kotlin.coroutines.coroutineContext[ActionReceipt]?.selected(tree, selected, 1)
        val before = leadingChildSignature(selected, direction)
        val receipt = kotlin.coroutines.coroutineContext[ActionReceipt]
        receipt?.progress(scrollProgress(before, null, false, "dispatch_pending"))
        fun result(outcome: TaskScrollOutcome, after: String?, comparable: Boolean, reason: String): ScrollSearchStep {
            val progress = scrollProgress(before, after, comparable, reason)
            receipt?.progress(progress)
            return ScrollSearchStep(TaskScrollOnceResult(outcome, resolvedContainerId, progress),
                containerIdentified = reason !in setOf("container_ambiguous", "container_identity_changed"))
        }
        if (!gestureSwipeWithin(selected, direction, distanceRatio)) {
            return@withRetry result(TaskScrollOutcome.GestureFailed, null, false, "gesture_failed")
        }
        delay(settleDelay)
        val rawAfter = uiTreeInspector.getCurrentUiTree()
            ?: return@withRetry result(TaskScrollOutcome.ContainerLost, null, false, "hierarchy_unavailable")
        val treeAfter = uiTreeFilterer.filterOnScreenOnly(rawAfter)
        val observation = identifyScrollScope(scope, treeAfter)
        val after = observation.node
        if (after == null) {
            val unavailable = result(
                if (observation.reason == "container_missing") TaskScrollOutcome.ContainerLost else TaskScrollOutcome.Unknown,
                null, false, observation.reason,
            )
            if (strict && observation.reason == "container_ambiguous") requireScrollScope(scope, treeAfter, strict)
            return@withRetry unavailable
        }
        val afterSignature = leadingChildSignature(after, direction)
        val progressResult = when {
            before == null || afterSignature == null -> result(TaskScrollOutcome.Unknown, afterSignature, false, "signature_unavailable")
            before == afterSignature -> result(TaskScrollOutcome.NoMovement, afterSignature, true, "signature_unchanged")
            else -> result(TaskScrollOutcome.Moved, afterSignature, true, "signature_changed")
        }
        progressResult.copy(
            scrollable = isScrollable(after),
            targetFound = target != null && scrollTarget(target, treeAfter, container, strict,
                findFirstScrollableChild, expectedScope = scope) != null,
        )
    }

    override suspend fun scrollLoop(
        target: NodeMatcher?,
        container: NodeMatcher?,
        direction: TaskScrollDirection,
        distanceRatio: Float,
        settleDelay: Duration,
        maxScrolls: Int,
        maxDuration: Duration,
        noPositionChangeThreshold: Int,
        findFirstScrollableChild: Boolean,
        strict: Boolean,
    ): TaskScrollLoopResult {
        require(maxScrolls > 0) { "maxScrolls must be > 0, got $maxScrolls" }
        require(distanceRatio in 0f..1f) { "distanceRatio must be in [0,1], got $distanceRatio" }

        Log.d("$TAG scrollLoop: dir=$direction maxScrolls=$maxScrolls maxDuration=$maxDuration")

        val uiTree = currentUiTreeFiltered()

        // Target checks also resolve the container and must preserve structured container failures.
        val resolvedContainerId: String?
        val initialContainer: UiNode
        try {
            if (target != null) {
                val visibleTarget = scrollTarget(target, uiTree, container, strict, findFirstScrollableChild)
                if (visibleTarget != null) {
                    Log.d("$TAG scrollLoop: TARGET_FOUND before scrolling")
                    return TaskScrollLoopResult(
                        terminationReason = TaskScrollTerminationReason.TargetFound,
                        scrollsExecuted = 0,
                        resolvedContainerId = null,
                        scope = if (!strict && container == null) null else
                            scrollNode(uiTree, container, strict, findFirstScrollableChild)?.let { TaskScrollScope(uiTree, it) },
                    )
                }
            }

            val scrollNode = scrollNode(uiTree, container, strict, findFirstScrollableChild) ?: throw UiActionFailure("CONTAINER_NOT_FOUND", "No scrollable container visible")
            resolvedContainerId = scrollNode.resourceId
            initialContainer = scrollNode
        } catch (e: IllegalStateException) {
            if (e is StrictSelectionException) throw e
            val reason = when ((e as? UiActionFailure)?.code) {
                "CONTAINER_NOT_SCROLLABLE" -> TaskScrollTerminationReason.ContainerNotScrollable
                "CONTAINER_NOT_FOUND" -> TaskScrollTerminationReason.ContainerNotFound
                else -> throw e
            }
            Log.w("$TAG scrollLoop: $reason - ${e.message}")
            return TaskScrollLoopResult(
                terminationReason = reason,
                scrollsExecuted = 0,
                resolvedContainerId = null,
            )
        }

        val mark = TimeSource.Monotonic.markNow()
        var scrollsExecuted = 0
        var noMovementCount = 0

        while (true) {
            // Duration cap
            if (mark.elapsedNow() >= maxDuration) {
                Log.d("$TAG scrollLoop: MAX_DURATION_REACHED after $scrollsExecuted scrolls")
                return TaskScrollLoopResult(
                    terminationReason = TaskScrollTerminationReason.MaxDurationReached,
                    scrollsExecuted = scrollsExecuted,
                    resolvedContainerId = resolvedContainerId,
                )
            }

            // Scroll cap
            if (scrollsExecuted >= maxScrolls) {
                Log.d("$TAG scrollLoop: MAX_SCROLLS_REACHED ($maxScrolls)")
                return TaskScrollLoopResult(
                    terminationReason = TaskScrollTerminationReason.MaxScrollsReached,
                    scrollsExecuted = scrollsExecuted,
                    resolvedContainerId = resolvedContainerId,
                )
            }

            // Execute one scroll step
            val stepResult = try {
                scrollOnceForTarget(
                    container = container,
                    direction = direction,
                    distanceRatio = distanceRatio,
                    settleDelay = settleDelay,
                    retry = TaskRetry.None,
                    findFirstScrollableChild = findFirstScrollableChild,
                    strict = strict,
                    target = target,
                    expectedContainer = TaskScrollScope(uiTree, initialContainer),
                )
            } catch (e: IllegalStateException) {
                if (e is StrictSelectionException && e.code != "CONTAINER_NOT_FOUND") throw e
                if (e !is QueryHierarchyUnavailableException && e !is StrictSelectionException &&
                    (e !is UiActionFailure || e.code !in setOf("CONTAINER_NOT_FOUND", "CONTAINER_NOT_SCROLLABLE", "CONTAINER_LOST"))) throw e
                // Eligibility loss is distinct from losing the original scope.
                return TaskScrollLoopResult(
                    terminationReason = if (e is UiActionFailure && e.code == "CONTAINER_NOT_SCROLLABLE")
                        TaskScrollTerminationReason.ContainerNotScrollable else TaskScrollTerminationReason.ContainerLost,
                    scrollsExecuted = scrollsExecuted,
                    resolvedContainerId = resolvedContainerId,
                )
            }

            if (stepResult.dispatched) scrollsExecuted++
            if (stepResult.targetFound) {
                return TaskScrollLoopResult(TaskScrollTerminationReason.TargetFound, scrollsExecuted, resolvedContainerId,
                    TaskScrollScope(uiTree, initialContainer))
            }

            if (stepResult.result.outcome == TaskScrollOutcome.ContainerLost) {
                return TaskScrollLoopResult(TaskScrollTerminationReason.ContainerLost, scrollsExecuted, resolvedContainerId)
            }
            // Do not assert a scoped target using an ambiguous or changed comparison container.
            if (target != null && stepResult.containerIdentified) {
                val found = try {
                    findVisibleTargetWithGracePeriod(target, settleDelay, container, strict, findFirstScrollableChild, TaskScrollScope(uiTree, initialContainer))
                } catch (error: IllegalStateException) {
                    val lost = error is QueryHierarchyUnavailableException ||
                        (error is UiActionFailure && error.code in setOf("CONTAINER_NOT_FOUND", "CONTAINER_LOST")) ||
                        (error is StrictSelectionException && error.code == "CONTAINER_NOT_FOUND")
                    if (!lost) throw error
                    return TaskScrollLoopResult(TaskScrollTerminationReason.ContainerLost, scrollsExecuted, resolvedContainerId)
                }
                if (found != null) return TaskScrollLoopResult(TaskScrollTerminationReason.TargetFound, scrollsExecuted, resolvedContainerId, TaskScrollScope(uiTree, initialContainer))
            }
            if (!stepResult.containerIdentified) {
                return TaskScrollLoopResult(TaskScrollTerminationReason.ContainerLost, scrollsExecuted, resolvedContainerId)
            }
            if (!stepResult.scrollable) {
                return TaskScrollLoopResult(TaskScrollTerminationReason.ContainerNotScrollable, scrollsExecuted, resolvedContainerId)
            }
            when (stepResult.result.outcome) {
                TaskScrollOutcome.EdgeReached -> return TaskScrollLoopResult(
                    TaskScrollTerminationReason.EdgeReached, scrollsExecuted, resolvedContainerId)
                TaskScrollOutcome.ContainerLost -> error("Container loss was handled before target observation")
                TaskScrollOutcome.NoMovement, TaskScrollOutcome.Unknown, TaskScrollOutcome.GestureFailed -> noMovementCount++
                TaskScrollOutcome.Moved -> noMovementCount = 0
            }

            // No-movement threshold
            if (noMovementCount >= noPositionChangeThreshold) {
                Log.d("$TAG scrollLoop: NO_POSITION_CHANGE after $scrollsExecuted scrolls (threshold=$noPositionChangeThreshold)")
                return TaskScrollLoopResult(
                    terminationReason = TaskScrollTerminationReason.NoPositionChange,
                    scrollsExecuted = scrollsExecuted,
                    resolvedContainerId = resolvedContainerId,
                )
            }
        }
    }

    private suspend fun currentUiTreeFiltered(): UiTree {
        val uiTreeRaw =
            uiTreeInspector.getCurrentUiTree()
                ?: throw QueryHierarchyUnavailableException(uiTreeInspector.getUnavailableHierarchyDiagnostics())
        return uiTreeFilterer.filterOnScreenOnly(uiTreeRaw)
    }

    private suspend fun findVisibleTargetWithGracePeriod(
        target: NodeMatcher,
        settleDelay: Duration,
        container: NodeMatcher?,
        strict: Boolean,
        findFirstScrollableChild: Boolean,
        scope: TaskScrollScope,
    ): UiNode? {
        val initialTree = currentUiTreeFiltered()
        scrollTarget(target, initialTree, container, strict, findFirstScrollableChild, expectedScope = scope)?.let { return it }

        val pollDelay =
            (settleDelay / 2)
                .coerceAtLeast(100.milliseconds)
                .coerceAtMost(500.milliseconds)

        repeat(3) {
            delay(pollDelay)
            val uiTree = currentUiTreeFiltered()
            scrollTarget(target, uiTree, container, strict, findFirstScrollableChild, expectedScope = scope)?.let { return it }
        }

        return null
    }

    private fun isScrollable(uiNode: UiNode): Boolean = uiNode.hints["scrollable"] == "true"

    private suspend fun gestureSwipeWithin(
        uiNode: UiNode,
        direction: TaskScrollDirection,
        distanceRatio: Float,
    ): Boolean =
        when (direction) {
            TaskScrollDirection.Down, TaskScrollDirection.Up ->
                gestureSwipeWithinVertical(uiNode, direction, distanceRatio)
            TaskScrollDirection.Left, TaskScrollDirection.Right ->
                gestureSwipeWithinHorizontal(uiNode, direction, distanceRatio)
        }

    private suspend fun gestureSwipeWithinVertical(
        uiNode: UiNode,
        direction: TaskScrollDirection,
        distanceRatio: Float,
    ): Boolean {
        val (startYRatio, endYRatio) =
            when (direction) {
                TaskScrollDirection.Down -> {
                    val start = 0.8f - (distanceRatio * 0.4f) // Start higher for down scroll
                    val end = start - (distanceRatio * 0.4f) // End lower
                    start to end
                }
                TaskScrollDirection.Up -> {
                    val start = 0.2f + (distanceRatio * 0.4f) // Start lower for up scroll
                    val end = start + (distanceRatio * 0.4f) // End higher
                    start to end
                }
                else -> error("Invalid vertical direction: $direction")
            }

        require(startYRatio in 0f..1f) { "Computed startYRatio must be in [0,1], got $startYRatio" }
        require(endYRatio in 0f..1f) { "Computed endYRatio must be in [0,1], got $endYRatio" }

        return uiTreeManager.swipeWithinVertical(uiNode, startYRatio, endYRatio)
    }

    private suspend fun gestureSwipeWithinHorizontal(
        uiNode: UiNode,
        direction: TaskScrollDirection,
        distanceRatio: Float,
    ): Boolean {
        // NOTE: Horizontal carousels often invert finger vs content direction.
        // Left = move content left (reveal right) → finger swipes RIGHT; Right → finger LEFT.
        val (startXRatio, endXRatio) =
            when (direction) {
                TaskScrollDirection.Left -> {
                    // TaskScrollDirection.Left = scroll content LEFT (reveal items to RIGHT)
                    // Requires swiping RIGHT on screen: start left-ish, end right-ish
                    val start = 0.2f + (distanceRatio * 0.4f)
                    val end = start + (distanceRatio * 0.4f)
                    start to end
                }
                TaskScrollDirection.Right -> {
                    // TaskScrollDirection.Right = scroll content RIGHT (reveal items to LEFT)
                    // Requires swiping LEFT on screen: start right-ish, end left-ish
                    val start = 0.8f - (distanceRatio * 0.4f)
                    val end = start - (distanceRatio * 0.4f)
                    start to end
                }
                else -> error("Invalid horizontal direction: $direction")
            }

        require(startXRatio in 0f..1f) { "Computed startXRatio must be in [0,1], got $startXRatio" }
        require(endXRatio in 0f..1f) { "Computed endXRatio must be in [0,1], got $endXRatio" }

        return uiTreeManager.swipeWithinHorizontal(uiNode, startXRatio, endXRatio)
    }

    /**
     * Creates a signature from the leading children to detect scroll progress.
     * Uses top children for vertical scrolling, left children for horizontal scrolling.
     */
    private fun leadingChildSignature(
        container: UiNode,
        direction: TaskScrollDirection,
    ): String? {
        val leading3 = container.children.take(3)
        if (leading3.isEmpty()) return null

        val evidence = leading3.joinToString("|") { node ->
            "${node.resourceId}:${node.className}:${node.bounds}:${node.label}:${node.contentDescription}:" +
                node.children.take(20).joinToString { "${it.resourceId}:${it.label}:${it.bounds}" }
        }
        return java.security.MessageDigest.getInstance("SHA-256").digest(evidence.toByteArray())
            .joinToString("") { "%02x".format(it) }
    }

    private fun scrollProgress(before: String?, after: String?, comparable: Boolean, reason: String): String =
        kotlinx.serialization.json.buildJsonObject {
            put("beforeSignature", before?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
            put("afterSignature", after?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull)
            put("comparable", kotlinx.serialization.json.JsonPrimitive(comparable))
            put("reason", kotlinx.serialization.json.JsonPrimitive(reason))
        }.toString()

    private data class ScrollScopeObservation(val node: UiNode?, val reason: String)

    private fun identifyScrollScope(scope: TaskScrollScope, tree: UiTree): ScrollScopeObservation {
        val nodes = NodeResolver(tree).resolve(null).map { it.node }
        val matches = nodes.filter { sameScrollContainer(scope.tree, scope.node, tree, it) }
        if (matches.size == 1) return ScrollScopeObservation(matches.single(), "container_identified")
        if (matches.size > 1) return ScrollScopeObservation(null, "container_ambiguous")
        val candidates = nodes.filter { it.resourceId == scope.node.resourceId && it.className == scope.node.className }
        return ScrollScopeObservation(null, when {
            candidates.size > 1 -> "container_ambiguous"
            candidates.isEmpty() -> "container_missing"
            else -> "container_identity_changed"
        })
    }

    private fun requireScrollScope(scope: TaskScrollScope, tree: UiTree, strict: Boolean): UiNode {
        val observation = identifyScrollScope(scope, tree)
        observation.node?.let { return it }
        if (strict && observation.reason == "container_ambiguous") {
            val resolver = NodeResolver(tree)
            val candidates = resolver.resolve(null).filter {
                it.node.resourceId == scope.node.resourceId && it.node.className == scope.node.className
            }
            throw StrictSelectionException("CONTAINER_AMBIGUOUS", candidates.size, resolver.encodeMatches(candidates))
        }
        throw UiActionFailure("CONTAINER_LOST", "The original scroll container can no longer be identified")
    }

    private fun sameScrollContainer(beforeTree: UiTree, before: UiNode, afterTree: UiTree, after: UiNode): Boolean {
        if (before.accessibilityNodeInfo != null && after.accessibilityNodeInfo != null) {
            return before.accessibilityNodeInfo == after.accessibilityNodeInfo
        }
        // Snapshot paths alone are never identity. Without platform identity require a unique
        // resource/class candidate in each observation and unchanged structural context.
        if (before.resourceId == null || before.resourceId != after.resourceId || before.className != after.className) return false
        fun candidates(tree: UiTree) = NodeResolver(tree).resolve(NodeMatcher(resourceId = before.resourceId))
        val old = candidates(beforeTree).singleOrNull() ?: return false
        val fresh = candidates(afterTree).singleOrNull() ?: return false
        return old.nodePath == fresh.nodePath && before.bounds == after.bounds &&
            old.ancestors.map { it.resourceId to it.className } == fresh.ancestors.map { it.resourceId to it.className }
    }

    private fun toTaskUiNode(uiNode: UiNode): TaskUiNode =
        TaskUiNode(
            resourceId = uiNode.resourceId,
            label = uiNode.label,
            contentDescription = uiNode.contentDescription,
            clickable = uiNode.isClickable,
            role = uiNode.role.name.lowercase(),
            bounds = uiNode.bounds,
            debugPath = uiNode.id.value,
        )

    private suspend fun logUiTree(
        uiTree: UiTree,
        label: String,
    ) {
        val treeLog =
            withContext(coroutineScopeIo.coroutineContext) {
                val indexMap = UiTreeTraversal.buildIndexMap(uiTree.root)
                uiTreeFormatter.toAsciiTree(
                    uiTree,
                    showTreeIndex = true,
                    showId = false,
                    indexMap = indexMap,
                )
            }
        Log.d("$TAG $label:\n$treeLog")
    }

    override suspend fun getCurrentToggleState(
        target: NodeMatcher,
        retry: TaskRetry,
    ): ToggleState =
        withRetry(
            retry = retry,
            operation = "getCurrentToggleState($target)",
            successPayload = { state, elapsedMs, attempt ->
                payload(
                    "target_matcher" to target.toString(),
                    "detected_state" to state.toString(),
                    "elapsed_ms" to elapsedMs,
                    "attempt" to attempt,
                )
            },
            failurePayload = { throwable, attempt ->
                val failurePoint =
                    when {
                        throwable.message?.contains("UI tree not available") == true -> "ui_tree_unavailable"
                        throwable.message?.contains("No UI node found") == true -> "toggle_container_not_found"
                        throwable.message?.contains("Toggle state could not be determined") == true -> "toggle_state_undetermined"
                        throwable.message?.contains("Click") == true && throwable.message?.contains("failed") == true -> "button_not_clickable"
                        else -> "unknown_error"
                    }
                payload(
                    "target_matcher" to target.toString(),
                    "failure_point" to failurePoint,
                    "attempt" to attempt,
                )
            },
        ) {
            Log.d("$TAG Getting current toggle state for target: $target")

            val uiTree = currentUiTreeFiltered()

            // Find the container using the NodeMatcher
            val container =
                NodeResolver(uiTree).resolve(target).firstOrNull()?.node ?: throw UiActionFailure("NODE_NOT_FOUND", "No UI node found matching criteria: $target")

            // Create a temporary sub-tree rooted at the container to search within
            val subTree = uiTree.copy(root = container)
            val state = subTree.inferOnOffState()

            if (state == ToggleState.Unknown) {
                Log.d("$TAG Toggle state detection returned Unknown for target: $target")
                throw IllegalStateException("Toggle state could not be determined for target: $target")
            }

            Log.d("$TAG ✅ Detected toggle state: $state")
            state
        }

    override suspend fun setCurrentToggleState(
        target: NodeMatcher,
        desiredState: ToggleState,
        retry: TaskRetry,
    ): ToggleState =
        withRetry(
            retry = retry,
            operation = "setCurrentToggleState($target, $desiredState)",
            successPayload = { state, elapsedMs, attempt ->
                payload(
                    "target_matcher" to target.toString(),
                    "desired_state" to desiredState.toString(),
                    "final_state" to state.toString(),
                    "elapsed_ms" to elapsedMs,
                    "attempt" to attempt,
                )
            },
            failurePayload = { throwable, attempt ->
                val failurePoint =
                    when {
                        throwable.message?.contains("UI tree not available") == true -> "ui_tree_unavailable"
                        throwable.message?.contains("No UI node found") == true -> "toggle_container_not_found"
                        throwable.message?.contains("Cannot click") == true -> "button_not_clickable"
                        else -> "unknown_error"
                    }
                payload(
                    "target_matcher" to target.toString(),
                    "desired_state" to desiredState.toString(),
                    "failure_point" to failurePoint,
                    "attempt" to attempt,
                )
            },
        ) {
            require(desiredState != ToggleState.Unknown) { "Cannot set toggle to Unknown state" }
            Log.d("$TAG Setting toggle state for target: $target to desired state: $desiredState")

            // First, get the current state
            val currentState = getCurrentToggleState(target, TaskRetry.None)
            Log.d("$TAG Current toggle state: $currentState")

            // If already in desired state, return it
            if (currentState == desiredState) {
                Log.d("$TAG Toggle already in desired state: $desiredState")
                return@withRetry currentState
            }

            // Determine which button to click based on desired state
            val buttonLabel =
                when (desiredState) {
                    ToggleState.On -> "On"
                    ToggleState.Off -> "Off"
                    ToggleState.Unknown -> {
                        Log.d("$TAG Cannot set toggle to Unknown state")
                        return@withRetry currentState
                    }
                }

            Log.d("$TAG Clicking '$buttonLabel' button to set toggle to $desiredState")

            // Find the container and locate the exact button to click
            val buttonToClick =
                findButtonInContainer(target, buttonLabel)
                    ?: throw IllegalStateException("Could not find '$buttonLabel' button in toggle container")

            // Click the exact button directly to avoid ambiguity
            clickExact(
                node = buttonToClick,
                clickTypes = UiTreeClickTypes.Default,
            )

            Log.d("$TAG Successfully clicked '$buttonLabel' button")

            // Wait a moment for the UI to update
            delay(500.milliseconds)

            // Get the final state after clicking
            val finalState = getCurrentToggleState(target, TaskRetry.None)
            Log.d("$TAG Final toggle state after clicking: $finalState")

            if (finalState == desiredState) {
                Log.d("$TAG ✅ Successfully set toggle to desired state: $desiredState")
            } else {
                Log.d("$TAG ⚠️ Toggle state did not change to desired state. Current: $finalState, Desired: $desiredState")
            }

            finalState
        }

    /**
     * Helper method to find a specific button within a toggle container.
     * Returns the exact UiNode to click directly, avoiding ambiguity with global matchers.
     *
     * @param containerMatcher NodeMatcher for finding the toggle container
     * @param buttonLabel The label of the button to find ("On" or "Off")
     * @return The exact UiNode to click, or null if not found
     */
    private suspend fun findButtonInContainer(
        containerMatcher: NodeMatcher,
        buttonLabel: String,
    ): UiNode? {
        val uiTree = currentUiTreeFiltered()

        // Find the container
        val container =
            NodeResolver(uiTree).resolve(containerMatcher).firstOrNull()?.node ?: return null

        // Create a temporary sub-tree rooted at the container to search within
        val subTree = uiTree.copy(root = container)

        // Find the exact button to click
        return UiTreeTraversal.findFirst(subTree) { uiNode ->
            uiNode.role == UiRole.Button && uiNode.label.equals(buttonLabel, ignoreCase = true)
        }
    }

    /**
     * Click a specific UiNode directly with consistent telemetry.
     * This provides the same logging and error handling as the regular click() method,
     * but operates on an already-resolved UiNode to avoid ambiguity.
     *
     * @param node The exact UiNode to click
     * @param clickTypes The type of click to perform
     */
    private suspend fun clickExact(
        node: UiNode,
        clickTypes: UiTreeClickTypes,
    ) {
        Log.d("$TAG Clicking exact node: ${node.label} (${node.role})")

        val clickSuccessful = uiTreeManager.triggerClick(node, clickTypes)
        if (!clickSuccessful) {
            Log.d("$TAG Click failed on node: ${node.label}")
            throw IllegalStateException("Click on node '${node.label}' failed")
        }

        Log.d("$TAG Successfully clicked exact node: ${node.label}")
    }
}

private fun resolveKeyValuePair(
    uiTree: UiTree,
    labelMatcher: NodeMatcher,
): Pair<String, String> {
    val labelNode = findNodeByMatcherForKeyValue(labelMatcher, uiTree)
        ?: throw IllegalStateException("NODE_NOT_FOUND")

    val path = mutableListOf<UiNode>()
    fun getPathTo(current: UiNode): Boolean {
        path.add(current)
        if (current.id == labelNode.id) return true
        for (child in current.children) {
            if (getPathTo(child)) return true
        }
        path.removeAt(path.size - 1)
        return false
    }
    if (!getPathTo(uiTree.root)) {
        throw IllegalStateException("NODE_NOT_FOUND")
    }

    for (i in path.size - 2 downTo 0) {
        val parent = path[i]
        val childInPath = path[i + 1]
        val siblingsAfter = parent.children.dropWhile { it.id != childInPath.id }.drop(1)

        if (parent.role.isKeyValueRowBoundary()) {
            if (siblingsAfter.isEmpty()) {
                throw IllegalStateException("VALUE_NODE_NOT_FOUND")
            }
            val descendants = siblingsAfter.flatMap(::flattenUiNodeSubtree).filter { it.label.isNotBlank() }
            val valueNode =
                descendants.firstOrNull { it.resourceId?.endsWith("/summary") == true } ?: descendants.firstOrNull()
                    ?: throw IllegalStateException("VALUE_NODE_NOT_FOUND")
            return labelNode.label.ifBlank { labelNode.contentDescription ?: "" } to valueNode.label
        }

        if (siblingsAfter.isNotEmpty()) {
            val descendants = siblingsAfter.flatMap(::flattenUiNodeSubtree).filter { it.label.isNotBlank() }
            val valueNode =
                descendants.firstOrNull { it.resourceId?.endsWith("/summary") == true } ?: descendants.firstOrNull()
                    ?: throw IllegalStateException("VALUE_NODE_NOT_FOUND")
            return labelNode.label.ifBlank { labelNode.contentDescription ?: "" } to valueNode.label
        }
    }

    throw IllegalStateException("VALUE_NODE_NOT_FOUND")
}

private fun flattenUiNodeSubtree(node: UiNode): List<UiNode> {
    val nodes = mutableListOf<UiNode>()

    fun collect(current: UiNode) {
        nodes.add(current)
        current.children.forEach(::collect)
    }

    collect(node)
    return nodes
}

private fun findNodeByMatcherForKeyValue(
    matcher: NodeMatcher,
    uiTree: UiTree,
): UiNode? = NodeResolver(uiTree).resolve(matcher).firstOrNull()?.node

private fun UiRole.isKeyValueRowBoundary(): Boolean =
    this == UiRole.Row || this == UiRole.ListItem || this == UiRole.Card
