package action.system.window

import action.log.Log
import action.system.ui.controller.UiControllerManager
import action.system.ui.controller.currentActivity
import action.system.unit.SystemUnitManager
import android.app.Activity
import android.content.Context
import androidx.compose.ui.unit.Dp
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import android.view.WindowManager as WindowManagerSystem

/**
 * Note: Proper support yet to be added for pre-Android 11.
 */
class WindowFrameManagerAndroid(
    private val context: Context,
    private val uiControllerManager: UiControllerManager,
    private val systemUnitManager: SystemUnitManager,
) : WindowFrameManager {
    override val isReady: MutableStateFlow<Boolean> = MutableStateFlow(false)

    private val activity: Activity?
        get() = uiControllerManager.currentActivity
    private val windowManager: WindowManagerSystem?
        get() = activity?.windowManager

    private val statusBarHeight: MutableStateFlow<Dp?> by lazy {
        val activity = activity
        val windowManager = windowManager
        val initialValue = if (activity != null && windowManager != null) {
            activity.statusBarHeight(windowManager, systemUnitManager)
        } else {
            null
        }
        MutableStateFlow(initialValue)
    }
    private val navigationBarHeight: MutableStateFlow<Dp?> by lazy {
        val activity = activity
        val windowManager = windowManager
        val initialValue = if (activity != null && windowManager != null) {
            activity.navigationBarHeight(windowManager, systemUnitManager)
        } else {
            null
        }
        MutableStateFlow(initialValue)
    }

    private val deviceSize: Pair<Int, Int>
        get() = context.deviceSize()

    private fun getWindowFrame(): WindowFrame {
        val deviceSize = deviceSize
        return WindowFrame(
            statusBarHeight = statusBarHeight.value,
            navigationBarHeight = navigationBarHeight.value,
            deviceWidth = systemUnitManager.pxToDp(deviceSize.first),
            deviceHeight = systemUnitManager.pxToDp(deviceSize.second),
            deviceWidthPx = deviceSize.first,
            deviceHeightPx = deviceSize.second,
        )
    }

    override fun currentFrame(): WindowFrame {
        // The Operator Activity may remain stopped across another app's rotation.
        // Refresh dimensions without declaring the UI lifecycle ready.
        return getWindowFrame().also { _windowFrame.value = it }
    }

    fun updateWindowFrame() {
        _windowFrame.value =
            getWindowFrame().also {
                Log.d("WindowFrame updated: $it")
            }
        isReady.value = true
    }

    private val _windowFrame: MutableStateFlow<WindowFrame> by lazy {
        MutableStateFlow(getWindowFrame())
    }
    override val windowFrame: StateFlow<WindowFrame>
        get() = _windowFrame

    fun updateInsetsAndFrame() {
        val activity = activity
        val windowManager = windowManager
        if (activity != null && windowManager != null) {
            statusBarHeight.value = activity.statusBarHeight(windowManager, systemUnitManager)
            navigationBarHeight.value = activity.navigationBarHeight(windowManager, systemUnitManager)
        }
        updateWindowFrame()
    }

    override fun setInsets(
        statusBarHeight: Dp,
        navBarHeight: Dp,
    ) {
        // Do nothing on Android
    }

    override fun setSize(
        deviceWidthPx: Int,
        deviceHeightPx: Int,
    ) {
        // Do nothing on Android
    }
}
