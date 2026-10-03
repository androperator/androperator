package androperator.task.runner

import androperator.uitree.TextSubmissionOutcome
import action.math.geometry.Point
import androperator.uitree.ToggleState
import androperator.uitree.UiTreeClickTypes
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

/**
 * DSL entry point for UI operations inside TaskScope.
 * Provides methods for UI inspection and interaction with retry support.
 */
interface TaskUiScope {
    suspend fun drag(start: Point, end: Point, holdDurationMs: Long, moveDurationMs: Long)

    suspend fun swipe(start: Point, end: Point, durationMs: Long)

    suspend fun queryUi(
        matcher: NodeMatcher? = null,
        visibility: String = "on_screen",
        limit: Int = 100,
    ): String

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
    suspend fun getValidatedText(
        matcher: NodeMatcher,
        retry: TaskRetry = TaskRetryPresets.UiReadiness,
        strict: Boolean = false,
        validator: (String) -> Boolean,
    ): String

    /**
     * Waits for a UI node that matches the specified NodeMatcher criteria to appear and returns it.
     * Retries according to the retry configuration until a matching node is found.
     *
     * @param matcher NodeMatcher containing the criteria to match
     * @param retry Retry configuration (defaults to no retry)
     * @param timeoutMs Optional wall-clock timeout in milliseconds. If provided, overrides retry
     *        timing and fails if node not found within timeout.
     * @return TaskUiNode representing the first matching UI element
     * @throws Exception if no matching element is found after all retry attempts or timeout
     */
    suspend fun waitForNode(
        matcher: NodeMatcher,
        retry: TaskRetry = TaskRetry.None,
        timeoutMs: Long? = null,
        strict: Boolean = false,
        container: NodeMatcher? = null,
    ): TaskUiNode

    /**
     * Reads a key-value pair from the screen. Finds the label, then finds an adjacent text node.
     */
    suspend fun readKeyValuePair(
        labelMatcher: NodeMatcher,
        retry: TaskRetry = TaskRetryPresets.UiReadiness,
    ): Pair<String, String>

    /**
     * Gets the text content of a UI element that matches the specified NodeMatcher criteria.

     * Retries according to the retry configuration until a matching element is found and text extracted.
     *
     * @param matcher NodeMatcher containing the criteria to match
     * @param retry Retry configuration (defaults to no retry)
     * @return The text content of the matching element
     * @throws Exception if no matching element is found or text cannot be extracted
     */
    suspend fun getText(
        matcher: NodeMatcher,
        retry: TaskRetry = TaskRetry.None,
        strict: Boolean = false,
    ): String

    /**
     * Gets the text content of a UI element that matches the specified NodeMatcher criteria,
     * searching only within the subtree of the container matched by [containerMatcher].
     *
     * @param matcher NodeMatcher containing the criteria to match for the target element
     * @param containerMatcher NodeMatcher for the container element whose subtree to search within
     * @param retry Retry configuration (defaults to no retry)
     * @return The text content of the matching element
     * @throws Exception if container not found, or no matching element found within container, or text cannot be extracted
     */
    suspend fun getTextWithinContainer(
        matcher: NodeMatcher,
        containerMatcher: NodeMatcher,
        retry: TaskRetry = TaskRetry.None,
        strict: Boolean = false,
    ): String

    /**
     * Gets the text content of a UI element that matches the specified NodeMatcher criteria,
     * searching only within the subtree of the container matched by [containerMatcher],
     * and validates it against the provided validator function.
     *
     * @param matcher NodeMatcher containing the criteria to match for the target element
     * @param containerMatcher NodeMatcher for the container element whose subtree to search within
     * @param retry Retry configuration (defaults to no retry)
     * @param validator Lambda function that validates the text content
     * @return The validated text content of the matching element
     * @throws Exception if container not found, no matching element found, text cannot be extracted, or validation fails
     */
    suspend fun getValidatedTextWithinContainer(
        matcher: NodeMatcher,
        containerMatcher: NodeMatcher,
        retry: TaskRetry = TaskRetry.None,
        strict: Boolean = false,
        validator: (String) -> Boolean,
    ): String

    /**
     * Gets the text content of ALL UI elements that match the specified NodeMatcher criteria.
     * Returns an empty list when no elements match; does not retry on empty results, only on
     * exceptions (e.g. UI tree unavailable).
     *
     * @param matcher NodeMatcher containing the criteria to match
     * @param retry Retry configuration (defaults to no retry)
     * @return List of text content from all matching elements; may be empty if none match
     * @throws Exception if the UI tree cannot be retrieved after all retry attempts
     */
    suspend fun getAllText(
        matcher: NodeMatcher,
        retry: TaskRetry = TaskRetry.None,
        strict: Boolean = false,
    ): List<String>

    /**
     * Gets the text content of ALL UI elements that match the specified NodeMatcher criteria,
     * searching only within the subtree of the container matched by [containerMatcher].
     * Returns an empty list when no elements match.
     *
     * @param matcher NodeMatcher containing the criteria to match for target elements
     * @param containerMatcher NodeMatcher for the container element whose subtree to search within
     * @param retry Retry configuration (defaults to no retry)
     * @return List of text content from all matching elements within the container; may be empty
     * @throws Exception if the UI tree cannot be retrieved after all retry attempts
     */
    suspend fun getAllTextWithinContainer(
        matcher: NodeMatcher,
        containerMatcher: NodeMatcher,
        retry: TaskRetry = TaskRetry.None,
        strict: Boolean = false,
    ): List<String>

    /**
     * Clicks a UI element that matches the specified NodeMatcher criteria.
     * Retries according to the retry configuration until the click is successful.
     *
     * @param matcher NodeMatcher containing the criteria to match
     * @param retry Retry configuration (defaults to no retry)
     * @param clickTypes The types of clicks to attempt (defaults to regular Click)
     * @throws Exception if no matching element is found or click fails
     */
    suspend fun click(
        matcher: NodeMatcher? = null,
        coordinate: Point? = null,
        clickTypes: UiTreeClickTypes = UiTreeClickTypes.Default,
        retry: TaskRetry = TaskRetry.None,
        strict: Boolean = false,
        container: NodeMatcher? = null,
    )

    /**
     * Scroll a container until a node matching [target] becomes visible.
     *
     * @param target        Node to reveal.
     * @param container     Optional matcher for the scrollable container. If null, the first on-screen scrollable is used.
     * @param direction     Direction of scrolling: Down/Up for vertical, Left/Right for horizontal (default Down).
     * @param maxSwipes     Safety cap on how many swipes to perform (must be > 0, default 10).
     * @param distanceRatio Swipe distance as a ratio of the container height (must be in [0.0, 1.0], default 0.7f).
     * @param settleDelay   Delay after each swipe before re-querying (default 250ms).
     * @param retry         Retry policy for reading/refreshing UI between swipes (default UiScroll).
     * @param findFirstScrollableChild If true and the matched container itself isn't scrollable,
     *        use its first scrollable descendant (useful for wrappers like GH "category_chips").
     * @return TestScrollResult.Found(node) or TestScrollResult.NotFoundExhausted
     */
    suspend fun scrollUntil(
        target: NodeMatcher,
        container: NodeMatcher? = null,
        direction: TaskScrollDirection = TaskScrollDirection.Down,
        maxSwipes: Int = 10,
        distanceRatio: Float = 0.7f,
        settleDelay: Duration = 250.milliseconds,
        retry: TaskRetry = TaskRetryPresets.UiScroll,
        findFirstScrollableChild: Boolean = false,
        strict: Boolean = false,
    ): TaskScrollResult

    /**
     * Convenience: ensure [target] is visible; throws if not found after scrolling.
     *
     * @param target        Node to reveal.
     * @param container     Optional matcher for the scrollable container. If null, the first on-screen scrollable is used.
     * @param direction     Direction of scrolling: Down/Up for vertical, Left/Right for horizontal (default Down).
     * @param maxSwipes     Safety cap on how many swipes to perform (must be > 0, default 10).
     * @param distanceRatio Swipe distance as a ratio of the container height (must be in [0.0, 1.0], default 0.7f).
     * @param settleDelay   Delay after each swipe before re-querying (default 250ms).
     * @param retry         Retry policy for reading/refreshing UI between swipes (default UiScroll).
     * @param findFirstScrollableChild If true and the matched container itself isn't scrollable,
     *        use its first scrollable descendant (useful for wrappers like GH "category_chips").
     * @return The revealed node if found.
     * @throws Exception    if the target node is not found after scrolling.
     */
    suspend fun scrollIntoView(
        target: NodeMatcher,
        container: NodeMatcher? = null,
        direction: TaskScrollDirection = TaskScrollDirection.Down,
        maxSwipes: Int = 10,
        distanceRatio: Float = 0.7f,
        settleDelay: Duration = 250.milliseconds,
        retry: TaskRetry = TaskRetryPresets.UiScroll,
        findFirstScrollableChild: Boolean = false,
        strict: Boolean = false,
    ): TaskUiNode

    /**
     * Performs a single scroll gesture within a container and reports the outcome.
     *
     * Unlike [scrollUntil], this does not search for a target element. It performs exactly one
     * swipe and reports whether content actually moved.
     *
     * @param container     Optional matcher for the scrollable container. If null, the first on-screen scrollable is used.
     * @param direction     Direction of scrolling: Down/Up for vertical, Left/Right for horizontal (default Down).
     * @param distanceRatio Swipe distance as a ratio of the container height/width (must be in [0.0, 1.0], default 0.7f).
     * @param settleDelay   Delay after the swipe before comparing signatures (default 250ms).
     * @param retry         Retry policy for container resolution (default no retry).
     * @param findFirstScrollableChild If true and the matched container itself isn't scrollable,
     *        use its first scrollable descendant.
     * @return [TaskScrollOnceResult] containing the [TaskScrollOutcome] and the resolved container's
     *         resourceId (when available). Outcome is [TaskScrollOutcome.Moved] if content shifted,
     *         [TaskScrollOutcome.NoMovement] for unchanged comparable evidence, [TaskScrollOutcome.Unknown]
     *         for incomparable evidence, [TaskScrollOutcome.ContainerLost] for a lost container,
     *         and [TaskScrollOutcome.GestureFailed] if the gesture failed. None proves an edge.
     * @throws Exception if the container cannot be found or is not scrollable.
     */
    suspend fun scrollOnce(
        container: NodeMatcher? = null,
        direction: TaskScrollDirection = TaskScrollDirection.Down,
        distanceRatio: Float = 0.7f,
        settleDelay: Duration = 250.milliseconds,
        retry: TaskRetry = TaskRetry.None,
        findFirstScrollableChild: Boolean = true,
        strict: Boolean = false,
    ): TaskScrollOnceResult

    /**
     * Bounded scroll loop. Scrolls repeatedly until a termination condition fires.
     * Always applies safety caps - no unbounded scroll is possible.
     *
     * @param container              Optional matcher for the scrollable container. Auto-detects if null.
     * @param direction              Scroll direction (default Down).
     * @param distanceRatio          Swipe distance ratio [0.0, 1.0] (default 0.7).
     * @param settleDelay            Delay after each swipe before signature check.
     * @param maxScrolls             Maximum number of scroll steps (hard cap, always applied).
     * @param maxDuration            Wall-clock time cap for the entire loop.
     * @param noPositionChangeThreshold  Number of consecutive no-movement scrolls before stopping.
     * @param findFirstScrollableChild   Walk one level down if matched container is not scrollable.
     * @return [TaskScrollLoopResult] with termination reason and scrolls executed.
     */
    suspend fun scrollLoop(
        target: NodeMatcher? = null,
        container: NodeMatcher? = null,
        direction: TaskScrollDirection = TaskScrollDirection.Down,
        distanceRatio: Float = 0.7f,
        settleDelay: Duration = 250.milliseconds,
        maxScrolls: Int = 20,
        maxDuration: Duration = 10.seconds,
        noPositionChangeThreshold: Int = 3,
        findFirstScrollableChild: Boolean = true,
        strict: Boolean = false,
    ): TaskScrollLoopResult

    /**
     * Convenience method that scrolls to find a target element and then clicks it.
     * This reduces matcher resolution churn by reusing the same target matcher.
     *
     * @param target        Node to reveal and click.
     * @param container     Optional matcher for the scrollable container. If null, the first on-screen scrollable is used.
     * @param direction     Direction of scrolling: Down/Up for vertical, Left/Right for horizontal (default Down).
     * @param maxSwipes     Safety cap on how many swipes to perform (must be > 0, default 10).
     * @param distanceRatio Swipe distance as a ratio of the container height (must be in [0.0, 1.0], default 0.7f).
     * @param settleDelay   Delay after each swipe before re-querying (default 250ms).
     * @param scrollRetry   Retry policy for scrolling (default UiScroll).
     * @param clickRetry    Retry policy for clicking (default UiReadiness).
     * @param findFirstScrollableChild If true and the matched container itself isn't scrollable,
     *        use its first scrollable descendant (useful for wrappers like GH "category_chips").
     * @param clickTypes    The types of clicks to attempt (defaults to regular Click).
     * @param clickAfter    When false, scrolls until visible but does not click (default true).
     * @throws Exception    if the target node is not found after scrolling or if clicking fails.
     */
    suspend fun clickAfterScroll(
        target: NodeMatcher,
        container: NodeMatcher? = null,
        clickTypes: UiTreeClickTypes = UiTreeClickTypes.Default,
        direction: TaskScrollDirection = TaskScrollDirection.Down,
        maxSwipes: Int = 10,
        distanceRatio: Float = 0.7f,
        settleDelay: Duration = 250.milliseconds,
        scrollRetry: TaskRetry = TaskRetryPresets.UiScroll,
        clickRetry: TaskRetry = TaskRetryPresets.UiReadiness,
        findFirstScrollableChild: Boolean = true,
        clickAfter: Boolean = true,
        strict: Boolean = false,
    ) {
        val result = scrollUntil(target, container, direction, maxSwipes, distanceRatio, settleDelay, scrollRetry, findFirstScrollableChild, strict)
        if (result !is TaskScrollResult.Found) throw UiActionFailure("NODE_NOT_FOUND", "Target node not found after scrolling: $target")
        if (clickAfter) {
            clickScrollTarget(
                target = target,
                findFirstScrollableChild = findFirstScrollableChild,
                clickTypes = clickTypes,
                retry = clickRetry,
                strict = strict,
                container = container,
                scope = result.scope,
            )
        }
    }

    suspend fun clickScrollTarget(
        target: NodeMatcher,
        container: NodeMatcher? = null,
        strict: Boolean = false,
        findFirstScrollableChild: Boolean = true,
        clickTypes: UiTreeClickTypes = UiTreeClickTypes.Default,
        retry: TaskRetry = TaskRetryPresets.UiReadiness,
        scope: TaskScrollScope? = null,
    ) {
        click(matcher = target, container = container, strict = strict, clickTypes = clickTypes, retry = retry)
    }

    /**
     * Gets the current toggle state within a specific container using flexible NodeMatcher criteria.
     * This is useful when there are multiple toggles on screen and you need to target a specific one.
     * Uses UiReadiness retry preset by default for handling UI settling.
     *
     * @param target NodeMatcher for finding the toggle container (e.g., by resourceId, text, role, etc.)
     * @param retry Custom retry configuration for handling UI settling (defaults to UiReadiness)
     * @return ToggleState.On if "On" button is selected, ToggleState.Off if "Off" button is selected,
     *         ToggleState.Unknown if neither or both are selected, container not found, or UI tree unavailable
     */
    suspend fun getCurrentToggleState(
        target: NodeMatcher,
        retry: TaskRetry = TaskRetryPresets.UiReadiness,
    ): ToggleState

    /**
     * Sets the toggle state within a specific container by clicking the appropriate button (On/Off).
     * First checks the current state, and if it doesn't match the desired state, clicks the appropriate button.
     * Uses UiReadiness retry preset by default for handling UI settling.
     *
     * @param target NodeMatcher for finding the toggle container (e.g., by resourceId, text, role, etc.)
     * @param desiredState The desired ToggleState (On or Off)
     * @param retry Custom retry configuration for handling UI settling (defaults to UiReadiness)
     * @return The final ToggleState after attempting to set it (On, Off, or Unknown if operation failed)
     */
    suspend fun setCurrentToggleState(
        target: NodeMatcher,
        desiredState: ToggleState,
        retry: TaskRetry = TaskRetryPresets.UiReadiness,
    ): ToggleState

    /**
     * Enters text into a UI element that matches [matcher].
     *
     * @param matcher NodeMatcher containing the criteria to match
     * @param text Text to set on the target field
     * @param submit If true, also dispatches an IME enter action after setting text
     * @param retry Retry configuration (defaults to no retry)
     * @throws Exception if no matching element is found or text entry fails
     */
    suspend fun enterText(
        matcher: NodeMatcher,
        text: String,
        submit: Boolean = false,
        clear: Boolean = false,
        retry: TaskRetry = TaskRetry.None,
        strict: Boolean = false,
        container: NodeMatcher? = null,
    ): TextSubmissionOutcome
}
