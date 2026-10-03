package androperator.uitree

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Represents the complete hierarchical UI tree of a screen.
 * Contains the root node and window information.
 */
@Serializable
@SerialName("UiTree")
data class UiTree(
    /** Root node of the UI tree */
    val root: UiNode,
    /** Window identifier from the accessibility service */
    val windowId: Int = -1,
    /** Structural context retained when filtering or selecting a subtree. */
    @kotlinx.serialization.Transient
    val sourceRoot: UiNode? = null,
)
