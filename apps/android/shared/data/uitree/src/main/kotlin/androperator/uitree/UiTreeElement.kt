package androperator.uitree

import action.math.geometry.Rect
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Represents a UI element found in the accessibility tree.
 * This is a platform-agnostic POKO that can be used across all platforms.
 */
@Serializable
@SerialName("UiTreeElement")
data class UiTreeElement(
    /** The display text or content description of the element */
    val text: String,
    /** Screen bounds of the element */
    val bounds: Rect,
    /** Platform class name of the element */
    val className: String,
    /** Whether the element is clickable/interactable */
    val isClickable: Boolean,
    /** Content description for accessibility */
    val contentDescription: String?,
    /** Unique identifier for the element if available */
    val resourceId: String?,
    /** Whether the element is currently enabled */
    val isEnabled: Boolean = true,
    /** Whether the element is currently visible */
    val isVisible: Boolean = true,
) {
    /**
     * Generates a unique identifier for this element based on its properties.
     * Used for deduplication purposes.
     */
    val uniqueId: String
        get() =
            buildString {
                append(text)
                append("_")
                append(bounds)
                append("_")
                append(className)
                append("_")
                append(isClickable)
                if (resourceId != null) {
                    append("_")
                    append(resourceId)
                }
            }

    /**
     * Whether this element has meaningful content to display or is interactable.
     * Includes elements with text, content descriptions, or clickable elements (like icon buttons).
     */
    val hasContent: Boolean
        get() =
            text.isNotBlank() ||
                contentDescription?.isNotBlank() == true ||
                isClickable
}
