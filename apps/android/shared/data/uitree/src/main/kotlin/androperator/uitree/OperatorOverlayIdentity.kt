package androperator.uitree

/**
 * Exact identity of an Operator-owned accessibility overlay window.
 *
 * Window package names are deliberately not sufficient. Other accessibility overlays from the
 * Operator package must retain their normal metadata and must not be treated as this panel.
 */
data class OperatorOverlayWindowIdentity(
    val id: Int,
    val type: Int,
    val title: String?,
)

interface OperatorOverlayIdentity {
    val isOperatorOverlayVisible: Boolean

    fun ownsOverlayWindow(window: OperatorOverlayWindowIdentity): Boolean
}

object OperatorOverlayIdentityNone : OperatorOverlayIdentity {
    override val isOperatorOverlayVisible: Boolean = false

    override fun ownsOverlayWindow(window: OperatorOverlayWindowIdentity): Boolean = false
}
