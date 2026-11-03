package androperator.task.runner

import androperator.uitree.UiNode
import androperator.uitree.UiTree
import androperator.uitree.UiDispatchObservation
import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext
import kotlin.time.TimeSource

class UiActionFailure(val code: String, message: String) : IllegalStateException(message)

/** Mutable evidence belongs to one execution, and survives cancellation of its child job. */
class ActionExecutionJournal : AbstractCoroutineContextElement(Key) {
    companion object Key : CoroutineContext.Key<ActionExecutionJournal>
    val steps = mutableListOf<UiActionStepResult>()
}

class ActionReceipt : AbstractCoroutineContextElement(Key) {
    companion object Key : CoroutineContext.Key<ActionReceipt>
    private val started = TimeSource.Monotonic.markNow()
    private val data = mutableMapOf("dispatch_method" to "none", "dispatch_accepted" to "false")
    private var tree: UiTree? = null
    private var matched: UiNode? = null

    fun selected(tree: UiTree, node: UiNode, count: Int) {
        this.tree = tree
        matched = node
        data.remove("progress")
        data.remove("matched_target")
        data.remove("target")
        data["candidate_count"] = count.toString()
        NodeResolver(tree).encodeNode(node)?.let { data["target"] = it }
    }

    fun progress(value: String) {
        data["progress"] = value
    }

    fun beginScrollSearchAttempt() {
        // A pre-dispatch failure may retry. Its terminal facts cannot describe an
        // interrupted later attempt, while a final click must retain the completed search.
        for (key in listOf("termination_reason", "scrolls_executed", "max_scrolls", "max_duration_ms",
            "resolved_container", "scroll_progress", "progress")) {
            data.remove(key)
        }
    }

    fun scrollTerminated(result: TaskScrollLoopResult, maxScrolls: Int, maxDurationMs: Long? = null) {
        data["termination_reason"] = result.terminationReason.toWireValue()
        data["scrolls_executed"] = result.scrollsExecuted.toString()
        data["max_scrolls"] = maxScrolls.toString()
        maxDurationMs?.let { data["max_duration_ms"] = it.toString() }
        result.resolvedContainerId?.let { data["resolved_container"] = it }
        // A subsequent target click replaces selection/gesture evidence. Retain the
        // final scroll observation separately so success and failure explain the search.
        data["progress"]?.let { data["scroll_progress"] = it }
    }

    fun coordinate(x: Double, y: Double) {
        data["coordinate"] = "{\"x\":$x,\"y\":$y}"
    }

    fun dispatch(target: Any?, method: String, accepted: Boolean) {
        data["dispatch_method"] = method
        data["dispatch_accepted"] = accepted.toString()
        val resolver = tree?.let(::NodeResolver) ?: return
        val actual = target?.let { reference ->
            resolver.resolve(null, "all").firstOrNull { it.node.accessibilityNodeInfo == reference }?.node
        }
        if (actual != null) {
            resolver.encodeNode(actual)?.let { data["target"] = it }
            if (actual.accessibilityNodeInfo != matched?.accessibilityNodeInfo || method == "coordinate_gesture") {
                matched?.let(resolver::encodeNode)?.let { data["matched_target"] = it }
            }
        } else if (target != null) {
            // Never label the matched node as an ancestor that was absent from the capture.
            data.remove("target")
            matched?.let(resolver::encodeNode)?.let { data["matched_target"] = it }
        }
    }

    val observation = UiDispatchObservation(::dispatch)
    fun stepData(): Map<String, String> = data + ("elapsed_ms" to started.elapsedNow().inWholeMilliseconds.toString())
}
