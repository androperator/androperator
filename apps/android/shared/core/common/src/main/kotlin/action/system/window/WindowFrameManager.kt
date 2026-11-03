package action.system.window

import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.flow.StateFlow

interface WindowFrameManager {
    val isReady: StateFlow<Boolean>

    val windowFrame: StateFlow<WindowFrame>

    /** A fresh frame for geometry-sensitive operations, including background services. */
    fun currentFrame(): WindowFrame = windowFrame.value

    fun setInsets(
        statusBarHeight: Dp,
        navBarHeight: Dp,
    )

    fun setSize(
        deviceWidthPx: Int,
        deviceHeightPx: Int,
    )
}
