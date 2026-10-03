package androperator.task.runner

import action.math.geometry.Rect
import androidx.compose.runtime.Stable

/**
 * Lightweight abstraction of a UI node for TaskRunner operations.
 * Contains essential information needed for UI inspection and interaction.
 */
@Stable
data class TaskUiNode(
    /** Android resource id, e.g. com.theswitchbot.switchbot:id/tvTemp (nullable if absent) */
    val resourceId: String?,
    /** Human-readable label (text or content description) */
    val label: String,
    /** Specific content description if available */
    val contentDescription: String? = null,
    /** Whether the element is clickable/interactable */
    val clickable: Boolean,
    /** Semantic role of this element (e.g., "button", "text", "image") */
    val role: String? = null,
    /** Screen bounds of the element */
    val bounds: Rect? = null,
    /** Debug-only dfs path for internal logs; not stable, not exposed to users */
    val debugPath: String,
) {
    override fun toString(): String = "TaskUiNode(resourceId=$resourceId, label='$label', clickable=$clickable, role=$role, bounds=$bounds)"
}
