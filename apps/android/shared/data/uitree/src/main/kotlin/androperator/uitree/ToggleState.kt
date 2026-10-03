package androperator.uitree

/**
 * Represents the state of an On/Off toggle control.
 */
enum class ToggleState {
    On,
    Off,
    Unknown,
}

/**
 * Infers the On/Off state from a UI tree by looking for buttons labeled "On" and "Off"
 * and checking their selected/checked state.
 *
 * @return ToggleState.On if "On" button is selected, ToggleState.Off if "Off" button is selected,
 *         ToggleState.Unknown if neither or both are selected
 */
fun UiTree.inferOnOffState(): ToggleState {
    val on =
        UiTreeTraversal.findFirst(this) {
            it.role == UiRole.Button && it.label.equals("On", ignoreCase = true)
        }
    val off =
        UiTreeTraversal.findFirst(this) {
            it.role == UiRole.Button && it.label.equals("Off", ignoreCase = true)
        }

    val onSelected = on?.hints?.get("selected") == "true" || on?.hints?.get("checked") == "true"
    val offSelected = off?.hints?.get("selected") == "true" || off?.hints?.get("checked") == "true"

    return when {
        onSelected && !offSelected -> ToggleState.On
        offSelected && !onSelected -> ToggleState.Off
        else -> ToggleState.Unknown
    }
}

/**
 * Finds the On/Off toggle container in the UI tree, typically by resourceId.
 * Then infers the toggle state within that container's subtree.
 *
 * @param containerResourceId The resource ID of the toggle container (e.g., "com.example:id/toggle")
 * @return ToggleState.On, ToggleState.Off, or ToggleState.Unknown
 */
fun UiTree.inferOnOffStateInContainer(containerResourceId: String): ToggleState {
    val container = UiTreeTraversal.findByResourceId(this, containerResourceId) ?: return ToggleState.Unknown

    // Create a temporary sub-tree rooted at the container to search within
    val subTree = UiTree(root = container, windowId = this.windowId)
    return subTree.inferOnOffState()
}
