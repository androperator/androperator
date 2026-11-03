package action.system.window

import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.flow.StateFlow

interface WindowFrameManager {
    val isReady: StateFlow<Boolean>

    val windowFrame: StateFlow<WindowFrame>

    /** Refresh geometry for synchronous consumers that may run while the Activity is backgrounded. */
    fun getCurrentWindowFrame(): WindowFrame = windowFrame.value

    fun setInsets(
        statusBarHeight: Dp,
        navBarHeight: Dp,
    )

    fun setSize(
        deviceWidthPx: Int,
        deviceHeightPx: Int,
    )
}
