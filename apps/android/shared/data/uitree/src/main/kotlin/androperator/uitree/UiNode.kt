package androperator.uitree

import action.math.geometry.Rect
import androidx.compose.runtime.Stable
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient

/**
 * Represents a node in the UI tree hierarchy.
 * Contains all relevant information about a UI element and its children.
 */
@Serializable
@SerialName("UiNode")
data class UiNode(
    /** Unique identifier for this node */
    val id: UiNodeId,
    /** Semantic role of this element */
    val role: UiRole,
    /** Human-readable label (text or content description) */
    val label: String,
    /** Specific content description if available */
    val contentDescription: String? = null,
    /** Platform-specific class name */
    val className: String,
    /** Screen bounds of the element */
    val bounds: Rect,
    /** Whether the element is clickable/interactable */
    val isClickable: Boolean,
    /** Whether the element is currently enabled */
    val isEnabled: Boolean,
    /** Whether the element is currently visible */
    val isVisible: Boolean,
    /** Unique resource identifier if available */
    val resourceId: String? = null,
    /** Android-reported sensitivity; null when unavailable or capture failed. */
    val accessibilityDataSensitive: Boolean? = null,
    /** Additional hints about the element (e.g., "heading"="true", "checked"="false") */
    val hints: Map<String, String> = emptyMap(),
    /** Child nodes in the hierarchy */
    val children: List<UiNode> = emptyList(),
    /** Original capture path retained by visibility filtering; never an action handle. */
    @Transient
    val sourcePath: String? = null,
    /**
     * Direct reference to the live Android AccessibilityNodeInfo object.
     * This field provides immediate access to the underlying accessibility node
     * for direct interaction (clicking, etc.).
     * Marked as @Transient to exclude from serialization.
     * This should always be non-null at runtime.
     * Capture transfers ownership to the tree: do not recycle retained handles.
     * They remain valid for identity checks and dispatch until the tree is released
     * and are then garbage collected, including on platforms with node pooling.
     */
    @Transient
    @Stable
    val accessibilityNodeInfo: Any? = null, // AccessibilityNodeInfo
)
