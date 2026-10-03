package androperator.uitree

data class UiWindowMetadata(
    val foregroundPackage: String? = null,
    val hasOverlay: Boolean = false,
    val overlayPackage: String? = null,
    val windowCount: Int = 0,
    val operatorOverlayVisible: Boolean = false,
)
