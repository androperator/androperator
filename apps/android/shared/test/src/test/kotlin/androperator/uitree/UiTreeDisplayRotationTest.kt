package androperator.uitree

import action.math.geometry.Rect
import action.system.ui.controller.UiControllerManager
import action.system.ui.controller.UiController
import action.system.unit.SystemUnitManagerAndroid
import action.system.window.WindowFrameManagerAndroid
import android.content.Context
import android.view.WindowManager
import androidx.test.core.app.ApplicationProvider
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowDisplay

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class UiTreeDisplayRotationTest {
    @Test
    fun `reading display geometry cannot mark UI ready without an Activity`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val frames = WindowFrameManagerAndroid(context, object : UiControllerManager {
            override val currentUiController: UiController? = null
        }, SystemUnitManagerAndroid(context))
        assertFalse(frames.isReady.value)
        UiTreeFiltererDefault(frames).filterOnScreenOnly(UiTree(node("ROOT", Rect(0f, 0f, 100f, 100f))))
        assertFalse(frames.isReady.value)
    }

    @Test
    fun `filter follows the live display while the Operator Activity is absent`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val display = (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay
        val shadow = Shadow.extract<ShadowDisplay>(display)
        fun size(width: Int, height: Int, rotation: Int) {
            shadow.setWidth(width)
            shadow.setHeight(height)
            shadow.setRealWidth(width)
            shadow.setRealHeight(height)
            shadow.setRotation(rotation)
        }
        size(1280, 2856, 0)
        val frames = WindowFrameManagerAndroid(context, object : UiControllerManager {
            override val currentUiController: UiController? = null
        }, SystemUnitManagerAndroid(context))
        val filter = UiTreeFiltererDefault(frames)
        assertEquals(1280, frames.windowFrame.value.deviceWidthPx)

        for (rotation in listOf(1, 3, 0)) {
            val width = if (rotation == 0) 1280 else 2856
            val height = if (rotation == 0) 2856 else 1280
            size(width, height, rotation)
            val left = node("LEFT_TARGET", Rect(48f, 176f, 192f, 320f))
            val right = node("RIGHT_TARGET", Rect(width - 216f, 176f, width - 72f, 320f))
            val hidden = node("HIDDEN_TARGET", left.bounds, visible = false)
            val outside = node("OFFSCREEN_TARGET", Rect(width + 10f, 176f, width + 154f, 320f))
            val root = node("ROOT", Rect(0f, 0f, width.toFloat(), height.toFloat()),
                children = listOf(left, right, hidden, outside))

            val filtered = filter.filterOnScreenOnly(UiTree(root)).root.children

            assertEquals(listOf("LEFT_TARGET", "RIGHT_TARGET"), filtered.map { it.label }, "rotation=$rotation")
            assertEquals(width, frames.windowFrame.value.deviceWidthPx)
            assertEquals(height, frames.windowFrame.value.deviceHeightPx)
            assertFalse(filtered.any { it.label == "HIDDEN_TARGET" || it.label == "OFFSCREEN_TARGET" })
        }
    }

    private fun node(label: String, bounds: Rect, visible: Boolean = true, children: List<UiNode> = emptyList()) = UiNode(
        id = UiNodeId(label), role = UiRole.Button, label = label, className = "android.widget.Button",
        bounds = bounds, isVisible = visible, isEnabled = true, isClickable = true, children = children,
    )
}
