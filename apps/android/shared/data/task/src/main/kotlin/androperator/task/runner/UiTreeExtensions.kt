package androperator.task.runner

import androperator.uitree.ToggleState
import androperator.uitree.UiTree
import androperator.uitree.inferOnOffState

/**
 * Finds the On/Off toggle container in the UI tree using a flexible NodeMatcher.
 * Then infers the toggle state within that container's subtree.
 *
 * @param containerMatcher NodeMatcher for finding the toggle container (e.g., by resourceId, text, role, etc.)
 * @return ToggleState.On, ToggleState.Off, or ToggleState.Unknown
 */
fun UiTree.inferOnOffStateInContainer(containerMatcher: NodeMatcher): ToggleState {
    val container = NodeResolver(this).resolve(containerMatcher).firstOrNull()?.node ?: return ToggleState.Unknown

    // Create a temporary sub-tree rooted at the container to search within
    val subTree = copy(root = container)
    return subTree.inferOnOffState()
}
