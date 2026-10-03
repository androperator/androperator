package androperator.task

import androperator.uitree.TextSubmissionOutcome
import action.log.Log
import androperator.task.runner.NodeMatcher
import androperator.task.runner.TaskRetry
import androperator.task.runner.TaskScrollDirection
import androperator.task.runner.TaskScrollLoopResult
import androperator.task.runner.TaskScrollOnceResult
import androperator.task.runner.TaskScrollOutcome
import androperator.task.runner.TaskScrollTerminationReason
import androperator.task.runner.TaskScrollResult
import androperator.task.runner.TaskUiNode
import androperator.task.runner.TaskUiScope
import androperator.uitree.ToggleState
import androperator.uitree.UiNode
import androperator.uitree.UiTree
import androperator.uitree.UiTreeAsciiParser
import androperator.uitree.UiTreeClickTypes
import androperator.uitree.UiTreeTraversal
import androperator.uitree.inferOnOffState
import kotlin.time.Duration

/**
 * Test implementation of TaskUiScope that works with pre-populated UI trees
 * instead of live accessibility services. This enables testing of UI workflows
 * using ASCII UI tree snapshots.
 */
class TaskUiScopeTest(
    private var currentUiTree: UiTree,
) : TaskUiScope {
    override suspend fun drag(start: action.math.geometry.Point, end: action.math.geometry.Point, holdDurationMs: Long, moveDurationMs: Long) { error("Unexpected drag") }

    override suspend fun swipe(start: action.math.geometry.Point, end: action.math.geometry.Point, durationMs: Long) {
        error("Swipe not configured in test")
    }

    override suspend fun queryUi(
        matcher: NodeMatcher?,
        visibility: String,
        limit: Int,
    ): String = error("Query not configured in test")


    /**
     * Updates the current UI tree state for testing scenario progression.
     */
    fun setUiTree(uiTree: UiTree) {
        currentUiTree = uiTree
    }

    /**
     * Parses ASCII UI tree output and sets it as the current state.
     */
    fun setUiTreeFromAscii(
        ascii: String,
        windowId: Int = -1,
    ) {
        currentUiTree = UiTreeAsciiParser.parse(ascii, windowId)
    }

    override suspend fun getValidatedText(
        matcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
        validator: (String) -> Boolean,
    ): String {
        val node =
            findNodeByMatcher(matcher)
                ?: throw IllegalStateException("No node found matching criteria")

        if (!validator(node.label)) {
            throw IllegalStateException("Text validation failed for: ${node.label}")
        }

        return node.label
    }

    override suspend fun waitForNode(
        matcher: NodeMatcher,
        retry: TaskRetry,
        timeoutMs: Long?,
        strict: Boolean,
        container: NodeMatcher?,
    ): TaskUiNode {
        val node =
            findNodeByMatcher(matcher)
                ?: throw IllegalStateException("No node found matching criteria")

        return TaskUiNode(
            resourceId = node.resourceId,
            label = node.label,
            clickable = node.isClickable,
            role = node.role.name.lowercase(),
            bounds = node.bounds,
            debugPath = node.id.value,
        )
    }

    override suspend fun getText(
        matcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
    ): String {
        val node =
            findNodeByMatcher(matcher)
                ?: throw IllegalStateException("No node found matching criteria")

        return node.label
    }

    override suspend fun getAllText(
        matcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
    ): List<String> {
        // Find all matching nodes and return their non-blank labels
        return androperator.uitree.UiTreeTraversal.findAll(currentUiTree) { uiNode ->
            val taskUiNode =
                TaskUiNode(
                    resourceId = uiNode.resourceId,
                    label = uiNode.label,
                    clickable = uiNode.isClickable,
                    role = uiNode.role.name.lowercase(),
                    bounds = uiNode.bounds,
                    debugPath = uiNode.id.value,
                )
            matcher.matches(taskUiNode)
        }.map { it.label }.filter { it.isNotBlank() }
    }

    override suspend fun getTextWithinContainer(
        matcher: NodeMatcher,
        containerMatcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
    ): String {
        // Find the container node
        val containerNode =
            androperator.uitree.UiTreeTraversal.findFirst(currentUiTree) { uiNode ->
                val taskUiNode =
                    TaskUiNode(
                        resourceId = uiNode.resourceId,
                        label = uiNode.label,
                        clickable = uiNode.isClickable,
                        role = uiNode.role.name.lowercase(),
                        bounds = uiNode.bounds,
                        debugPath = uiNode.id.value,
                    )
                containerMatcher.matches(taskUiNode)
            } ?: throw IllegalStateException("Container not found for: $containerMatcher")

        // Create a sub-tree rooted at the container
        val subTree = androperator.uitree.UiTree(root = containerNode, windowId = currentUiTree.windowId)

        // Find the target node within the container subtree
        val targetNode =
            androperator.uitree.UiTreeTraversal.findFirst(subTree) { uiNode ->
                val taskUiNode =
                    TaskUiNode(
                        resourceId = uiNode.resourceId,
                        label = uiNode.label,
                        clickable = uiNode.isClickable,
                        role = uiNode.role.name.lowercase(),
                        bounds = uiNode.bounds,
                        debugPath = uiNode.id.value,
                    )
                matcher.matches(taskUiNode)
            } ?: throw IllegalStateException("No UI node found matching criteria: $matcher within container: $containerMatcher")

        return targetNode.label
    }

    override suspend fun getAllTextWithinContainer(
        matcher: NodeMatcher,
        containerMatcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
    ): List<String> {
        // Find the container node
        val containerNode =
            androperator.uitree.UiTreeTraversal.findFirst(currentUiTree) { uiNode ->
                val taskUiNode =
                    TaskUiNode(
                        resourceId = uiNode.resourceId,
                        label = uiNode.label,
                        clickable = uiNode.isClickable,
                        role = uiNode.role.name.lowercase(),
                        bounds = uiNode.bounds,
                        debugPath = uiNode.id.value,
                    )
                containerMatcher.matches(taskUiNode)
            } ?: throw IllegalStateException("Container not found for: $containerMatcher")

        // Create a sub-tree rooted at the container
        val subTree = androperator.uitree.UiTree(root = containerNode, windowId = currentUiTree.windowId)

        // Find all matching nodes within the container subtree
        return androperator.uitree.UiTreeTraversal.findAll(subTree) { uiNode ->
            val taskUiNode =
                TaskUiNode(
                    resourceId = uiNode.resourceId,
                    label = uiNode.label,
                    clickable = uiNode.isClickable,
                    role = uiNode.role.name.lowercase(),
                    bounds = uiNode.bounds,
                    debugPath = uiNode.id.value,
                )
            matcher.matches(taskUiNode)
        }.map { it.label }.filter { it.isNotBlank() }
    }

    override suspend fun getValidatedTextWithinContainer(
        matcher: NodeMatcher,
        containerMatcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
        validator: (String) -> Boolean,
    ): String {
        // Find the container node
        val containerNode =
            androperator.uitree.UiTreeTraversal.findFirst(currentUiTree) { uiNode ->
                val taskUiNode =
                    TaskUiNode(
                        resourceId = uiNode.resourceId,
                        label = uiNode.label,
                        clickable = uiNode.isClickable,
                        role = uiNode.role.name.lowercase(),
                        bounds = uiNode.bounds,
                        debugPath = uiNode.id.value,
                    )
                containerMatcher.matches(taskUiNode)
            } ?: throw IllegalStateException("Container not found for: $containerMatcher")

        // Create a sub-tree rooted at the container
        val subTree = androperator.uitree.UiTree(root = containerNode, windowId = currentUiTree.windowId)

        // Find the target node within the container subtree
        val targetNode =
            androperator.uitree.UiTreeTraversal.findFirst(subTree) { uiNode ->
                val taskUiNode =
                    TaskUiNode(
                        resourceId = uiNode.resourceId,
                        label = uiNode.label,
                        clickable = uiNode.isClickable,
                        role = uiNode.role.name.lowercase(),
                        bounds = uiNode.bounds,
                        debugPath = uiNode.id.value,
                    )
                matcher.matches(taskUiNode)
            } ?: throw IllegalStateException("No UI node found matching criteria: $matcher within container: $containerMatcher")

        val text = targetNode.label
        if (!validator(text)) {
            throw IllegalStateException("Validation failed for text '$text' from matching UI node within container")
        }
        return text
    }

    override suspend fun click(
        matcher: NodeMatcher?,
        coordinate: action.math.geometry.Point?,
        clickTypes: UiTreeClickTypes,
        retry: TaskRetry,
        strict: Boolean,
        container: NodeMatcher?,
    ) {
        if (coordinate != null) {
            println("[TaskUiScopeTest] Clicked coordinate: ${coordinate.shortString}")
            return
        }

        val node =
            findNodeByMatcher(matcher ?: throw IllegalStateException("click requires matcher or coordinate"))
                ?: throw IllegalStateException("No node found matching criteria")

        if (!node.isClickable) {
            throw IllegalStateException("Node is not clickable: ${node.label}")
        }

        // In a real test, you might update the UI tree state here to simulate the click result
        println("[TaskUiScopeTest] Clicked node: ${node.label}")
    }

    override suspend fun scrollOnce(
        container: NodeMatcher?,
        direction: TaskScrollDirection,
        distanceRatio: Float,
        settleDelay: Duration,
        retry: TaskRetry,
        findFirstScrollableChild: Boolean,
        strict: Boolean,
    ): TaskScrollOnceResult = TaskScrollOnceResult(TaskScrollOutcome.Moved)

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
    ): TaskScrollLoopResult = TaskScrollLoopResult(TaskScrollTerminationReason.EdgeReached, scrollsExecuted = 5)

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
    ): TaskScrollResult {
        // In test implementation, just check if the target is already there
        val targetNode = findNodeByMatcher(target)
        return if (targetNode != null) {
            TaskScrollResult.Found(
                TaskUiNode(
                    resourceId = targetNode.resourceId,
                    label = targetNode.label,
                    clickable = targetNode.isClickable,
                    role = targetNode.role.name.lowercase(),
                    bounds = targetNode.bounds,
                    debugPath = targetNode.id.value,
                ),
            )
        } else {
            TaskScrollResult.NotFoundExhausted
        }
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
    ): TaskUiNode {
        val result = scrollUntil(target, container, direction, maxSwipes, distanceRatio, settleDelay, retry, findFirstScrollableChild)
        return when (result) {
            is TaskScrollResult.Found -> result.node
            is TaskScrollResult.NotFoundExhausted -> throw IllegalStateException("Target not found after scrolling")
        }
    }

    private fun findNodeByMatcher(matcher: NodeMatcher): UiNode? {
        // Convert NodeMatcher criteria to UiTreeTraversal search
        return UiTreeTraversal.findFirst(currentUiTree) { uiNode ->
            // Create a TaskUiNode to test the matcher against
            val taskUiNode =
                TaskUiNode(
                    resourceId = uiNode.resourceId,
                    label = uiNode.label,
                    clickable = uiNode.isClickable,
                    role = uiNode.role.name.lowercase(),
                    bounds = uiNode.bounds,
                    debugPath = uiNode.id.value,
                )
            matcher.matches(taskUiNode)
        }
    }

    /**
     * Helper method to get the current toggle state within a specific container using NodeMatcher.
     */
    override suspend fun getCurrentToggleState(
        target: NodeMatcher,
        retry: TaskRetry,
    ): ToggleState {
        // For test implementation, we don't need retry logic since we have static UI trees

        // Find the container using the NodeMatcher
        val container =
            androperator.uitree.UiTreeTraversal.findFirst(currentUiTree) { uiNode ->
                val taskUiNode =
                    TaskUiNode(
                        resourceId = uiNode.resourceId,
                        label = uiNode.label,
                        clickable = uiNode.isClickable,
                        role = uiNode.role.name.lowercase(),
                        bounds = uiNode.bounds,
                        debugPath = uiNode.id.value,
                    )
                target.matches(taskUiNode)
            } ?: return ToggleState.Unknown

        // Create a temporary sub-tree rooted at the container to search within
        val subTree = androperator.uitree.UiTree(root = container, windowId = currentUiTree.windowId)
        return subTree.inferOnOffState()
    }

    /**
     * Helper method to set the toggle state within a specific container using NodeMatcher.
     */
    override suspend fun setCurrentToggleState(
        target: NodeMatcher,
        desiredState: ToggleState,
        retry: TaskRetry,
    ): ToggleState {
        // For test implementation, we simulate setting the toggle state
        // In a real implementation, this would click the appropriate button
        // For testing, we'll just return the desired state
        Log.d("TaskUiScopeTest", "Simulating setting toggle state to: $desiredState")
        return desiredState
    }

    /**
     * Helper method to find a specific button within a toggle container (test implementation).
     */
    private suspend fun findButtonInContainer(
        containerMatcher: NodeMatcher,
        buttonLabel: String,
    ): androperator.uitree.UiNode? {
        // For test implementation, we don't need to actually find UI nodes
        // This method is primarily used in the production implementation
        return null
    }

    /**
     * Click a specific UiNode directly (test implementation).
     */
    private suspend fun clickExact(
        node: androperator.uitree.UiNode,
        clickTypes: androperator.uitree.UiTreeClickTypes,
    ) {
        // For test implementation, we simulate clicking
        Log.d("TaskUiScopeTest", "Simulating click on node: ${node.label}")
    }

    /**
     * Enters text into a UI element that matches [matcher].
     */
    override suspend fun enterText(
        matcher: NodeMatcher,
        text: String,
        submit: Boolean,
        clear: Boolean,
        retry: TaskRetry,
        strict: Boolean,
        container: NodeMatcher?,
    ): TextSubmissionOutcome {
        val node =
            findNodeByMatcher(matcher)
                ?: throw IllegalStateException("No node found matching criteria")

        if (!node.isClickable) {
            throw IllegalStateException("Node is not editable: ${node.label}")
        }

        println("[TaskUiScopeTest] Entered text into node: ${node.label} (len=${text.length}, clear=$clear, submit=$submit)")
        return if (submit) TextSubmissionOutcome.Unavailable else TextSubmissionOutcome.NotRequested
    }

    /**
     * Reads a key-value pair from the UI.
     * Test implementation finds the label node and returns a mock value.
     */
    override suspend fun readKeyValuePair(
        labelMatcher: NodeMatcher,
        retry: TaskRetry,
    ): Pair<String, String> {
        val labelNode =
            findNodeByMatcher(labelMatcher)
                ?: throw IllegalStateException("NODE_NOT_FOUND")

        // For test implementation, return the label and a mock value
        // In a real test scenario, this would look for an adjacent value node
        val label = labelNode.label.ifBlank { labelNode.contentDescription ?: "" }
        val value = "test-value"
        return Pair(label, value)
    }
}
