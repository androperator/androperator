package androperator.task.runner

/**
 * Result of a scroll operation.
 */
sealed interface TaskScrollResult {
    /** Target node was found and scrolled into view */
    data class Found(
        val node: TaskUiNode,
        val scope: TaskScrollScope? = null,
    ) : TaskScrollResult

    /** Scrolling was exhausted without finding the target */
    data object NotFoundExhausted : TaskScrollResult
}

/** Observed progress after one gesture; unchanged content does not prove an edge. */
enum class TaskScrollOutcome {
    Moved,
    NoMovement,
    Unknown,
    ContainerLost,
    EdgeReached,
    GestureFailed,
}

/**
 * Full result of a single standalone scroll gesture (see [TaskUiScope.scrollOnce]).
 *
 * Extends [TaskScrollOutcome] with observability fields:
 * - [resolvedContainerId]: the resourceId of the container that was scrolled. Populated
 *   when auto-detection is used so callers can confirm which container was selected.
 */
data class TaskScrollOnceResult(
    val outcome: TaskScrollOutcome,
    val resolvedContainerId: String? = null,
    val progress: String? = null,
)

/**
 * Reason a [TaskUiScope.scrollLoop] bounded scroll loop terminated.
 */
enum class TaskScrollTerminationReason {
    /** Target matcher became visible in the current UI tree */
    TargetFound,
    /** Content ended naturally - leading-child signature unchanged at the boundary */
    EdgeReached,
    /** Hit the [UiAction.ScrollUntil.maxScrolls] safety cap */
    MaxScrollsReached,
    /** Hit the [UiAction.ScrollUntil.maxDurationMs] safety cap */
    MaxDurationReached,
    /** No content movement across [UiAction.ScrollUntil.noPositionChangeThreshold] consecutive scrolls */
    NoPositionChange,
    /** Container resolution failed before any scroll was attempted */
    ContainerNotFound,
    /** Container matched but is not scrollable */
    ContainerNotScrollable,
    /** Container disappeared mid-loop (e.g. app navigated away) */
    ContainerLost,
}

/** An observation retained only for identity checks within one scroll operation. */
data class TaskScrollScope(val tree: androperator.uitree.UiTree, val node: androperator.uitree.UiNode)

/**
 * Full result of a [TaskUiScope.scrollLoop] bounded scroll loop.
 */
data class TaskScrollLoopResult(
    val terminationReason: TaskScrollTerminationReason,
    val scrollsExecuted: Int,
    val resolvedContainerId: String? = null,
    val scope: TaskScrollScope? = null,
)
