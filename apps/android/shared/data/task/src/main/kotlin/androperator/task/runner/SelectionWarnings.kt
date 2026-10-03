package androperator.task.runner

import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext

/** Collects duplicate selection observations for one action, including its retries. */
class SelectionWarnings : AbstractCoroutineContextElement(SelectionWarnings) {
    companion object Key : CoroutineContext.Key<SelectionWarnings>

    private val largestCounts = linkedMapOf<String, Int>()

    fun record(count: Int, container: Boolean) {
        val kind = if (container) "container" else "target"
        largestCounts[kind] = maxOf(largestCounts[kind] ?: 0, count)
    }

    fun stepData(): Map<String, String> {
        if (largestCounts.isEmpty()) return emptyMap()
        val counts = largestCounts.entries.joinToString(", ") { (kind, count) -> "$kind: $count" }
        return mapOf(
            "selection_warning" to "Multiple candidates matched; first-match selection was used. " +
                "Largest candidate counts observed: $counts. " +
                "Use --strict (params.strict=true) to reject ambiguous matches.",
        )
    }
}
