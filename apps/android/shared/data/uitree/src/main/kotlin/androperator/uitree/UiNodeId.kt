package androperator.uitree

import action.math.geometry.Rect
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * INTERNAL. Do not use for selection, persistence, or user-facing references.
 * May vary between runs, versions, devices, and layouts.
 *
 * A unique identifier for a UI node in the tree.
 * Format: "windowId:indexPath[#hash]" e.g., "3:0.2.1#abc"
 */
@JvmInline
@Serializable
@SerialName("UiNodeId")
value class UiNodeId(
    val value: String,
) {
    override fun toString(): String = value

    companion object {
        /**
         * Creates a UiNodeId with optional content hash for stability.
         */
        fun create(
            windowId: Int,
            indexPath: IntArray,
            label: String = "",
            className: String = "",
            bounds: Rect = Rect.Zero,
            includeHash: Boolean = false,
        ): UiNodeId {
            val pathString = "$windowId:${indexPath.joinToString(".")}"

            if (!includeHash) {
                return UiNodeId(pathString)
            }

            // Create content hash from stable properties
            val contentString =
                buildString {
                    append(label)
                    append("|")
                    append(className)
                    append("|")
                    append(bounds.left.toInt())
                    append(",")
                    append(bounds.top.toInt())
                    append(",")
                    append(bounds.right.toInt())
                    append(",")
                    append(bounds.bottom.toInt())
                }

            val hash = contentString.hashCode().toString(16).take(6)
            return UiNodeId("$pathString#$hash")
        }
    }
}
