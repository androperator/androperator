package androperator.uitree

import action.math.geometry.Rect
import action.system.ui.controller.UiControllerManager
import action.system.unit.SystemUnitManagerMock
import action.system.window.WindowFrameManagerAndroid
import android.app.Application
import android.content.Context
import android.view.WindowManager
import androidx.test.core.app.ApplicationProvider
import androperator.task.runner.NodeMatcher
import androperator.task.runner.NodeResolver
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import kotlin.test.Test
import kotlin.test.assertEquals

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29, 30], manifest = Config.NONE, application = Application::class)
class LandscapeTargetingTest {
    @Test
    fun `filter follows background display rotations and excludes hidden and offscreen nodes`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val display = (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay
        val shadowDisplay = shadowOf(display)
        shadowDisplay.setRealWidth(1280)
        shadowDisplay.setRealHeight(2856)
        val manager = WindowFrameManagerAndroid(
            context,
            object : UiControllerManager { override val currentUiController = null },
            SystemUnitManagerMock(3f),
        )
        manager.updateWindowFrame()
        val filterer = UiTreeFiltererDefault(manager)
        // No Activity lifecycle or inset callback runs after initialization.
        for ((rotation, width, height) in listOf(
            Triple(1, 2856, 1280), Triple(3, 2856, 1280), Triple(0, 1280, 2856),
        )) {
            shadowDisplay.setRotation(rotation)
            shadowDisplay.setRealWidth(width)
            shadowDisplay.setRealHeight(height)
            val tree = UiTree(node("ROOT", Rect(0f, 0f, width.toFloat(), height.toFloat()), children = listOf(
                node("LEFT_TARGET", Rect(96f, 176f, 516f, 356f)),
                node("RIGHT_TARGET", Rect(width - 516f, 176f, width - 96f, 356f)),
                node("HIDDEN_TARGET", Rect(96f, 176f, 516f, 356f), visible = false),
                node("OFFSCREEN_TARGET", Rect(width + 96f, 176f, width + 516f, 356f)),
                node("BELOW_TARGET", Rect(96f, height + 96f, 516f, height + 276f)),
                node("DUPLICATE", Rect(96f, 400f, 516f, 580f)),
                node("DUPLICATE", Rect(width - 516f, 400f, width - 96f, 580f)),
            )))
            val resolver = NodeResolver(filterer.filterOnScreenOnly(tree))
            for (target in listOf("LEFT_TARGET", "RIGHT_TARGET")) {
                assertEquals(1, resolver.resolve(NodeMatcher(contentDescEquals = target)).size, "rotation=$rotation $target")
            }
            for (target in listOf("HIDDEN_TARGET", "OFFSCREEN_TARGET", "BELOW_TARGET")) {
                assertEquals(0, resolver.resolve(NodeMatcher(contentDescEquals = target)).size, "rotation=$rotation $target")
                assertEquals(1, resolver.resolve(NodeMatcher(contentDescEquals = target), "all").size)
            }
            assertEquals(2, resolver.resolve(NodeMatcher(contentDescEquals = "DUPLICATE")).size)
        }
    }

    private fun node(label: String, bounds: Rect, visible: Boolean = true, children: List<UiNode> = emptyList()) = UiNode(
        id = UiNodeId(label), role = UiRole.Button, label = label, contentDescription = label,
        className = "android.widget.Button", bounds = bounds,
        isClickable = true, isEnabled = true, isVisible = visible, children = children,
    )
}
