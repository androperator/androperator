package androperator.uitree

/**
 * Extension functions to flatten hierarchical UiNode structures into flat lists
 * for backwards compatibility with existing UiTreeElement consumers.
 */

/**
 * Flattens a UiNode hierarchy into a flat list of UiTreeElement objects.
 * Performs a depth-first traversal of the tree.
 */
fun UiNode.flatten(acc: MutableList<UiTreeElement> = mutableListOf()): List<UiTreeElement> {
    // Add this node to the flattened list
    acc +=
        UiTreeElement(
            text = label,
            bounds = bounds,
            className = className,
            isClickable = isClickable,
            contentDescription = null, // Label already combines text and content description
            resourceId = resourceId,
            isEnabled = isEnabled,
            isVisible = isVisible,
        )

    // Recursively flatten children
    children.forEach { it.flatten(acc) }

    return acc
}

/**
 * Flattens an entire UiTree into a flat list of UiTreeElement objects.
 */
fun UiTree.flatten(): List<UiTreeElement> = root.flatten()
