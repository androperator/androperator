package androperator.task.runner

import android.app.Application
import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import androperator.accessibilityservice.buildUiTree
import androperator.test.ActionTest
import androperator.test.actionTest
import androperator.uitree.UiTree
import androperator.uitree.UiTreeFilterer
import androperator.uitree.UiTreeFormatter
import androperator.uitree.UiTreeInspector
import androperator.uitree.UiTreeManager
import androperator.uitree.UiWindowMetadata
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadow.api.Shadow
import org.robolectric.util.ReflectionHelpers
import java.lang.reflect.Proxy
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [31, 32], manifest = Config.NONE, application = Application::class,
    shadows = [ScrollNodeLifetimeTest.PlatformNodeTraversal::class])
class ScrollNodeLifetimeTest : ActionTest {
    // Only traversal is simulated. In particular, obtain, equals and recycle use the
    // SDK implementation, unlike Robolectric's default AccessibilityNodeInfo shadow.
    @Implements(AccessibilityNodeInfo::class)
    class PlatformNodeTraversal {
        var children: List<AccessibilityNodeInfo> = emptyList()

        @Implementation
        fun getChildCount(): Int = children.size

        @Implementation
        fun getChild(index: Int): AccessibilityNodeInfo {
            val source = children[index]
            return AccessibilityNodeInfo.obtain(source).also {
                Shadow.extract<PlatformNodeTraversal>(it).children = Shadow.extract<PlatformNodeTraversal>(source).children
            }
        }

        @Implementation
        fun getParent(): AccessibilityNodeInfo? = null
    }

    private fun node(identity: Long, resourceId: String, children: List<AccessibilityNodeInfo> = emptyList(),
        scrollable: Boolean = false): AccessibilityNodeInfo = AccessibilityNodeInfo.obtain().apply {
        ReflectionHelpers.setField(this, "mSourceNodeId", identity)
        ReflectionHelpers.setField(this, "mWindowId", 1)
        viewIdResourceName = resourceId
        className = "android.view.View"
        text = resourceId
        isVisibleToUser = true
        isEnabled = true
        isClickable = true
        isScrollable = scrollable
        setBoundsInScreen(Rect(0, 0, 100, 100))
        Shadow.extract<PlatformNodeTraversal>(this).children = children
    }

    private fun capture(revealed: Boolean): UiTree {
        val children = listOf(node(3, "row")) + if (revealed) listOf(node(4, "target")) else emptyList()
        val outer = node(2, "outer", children, scrollable = !revealed)
        return node(1, "root", listOf(outer)).buildUiTree(1)
    }

    @Test
    fun `fixture uses platform recycling and identity equality`() {
        val first = node(10, "first")
        val second = node(11, "second")
        assertNotEquals(first, second)
        assertEquals(first, AccessibilityNodeInfo.obtain(first))
        first.recycle()
        second.recycle()
        assertEquals(first, second, "Pre-33 recycling clears both identity fields")
    }

    @Test
    fun `captured identities survive subsequent captures and remain distinct`() {
        val before = capture(false)
        val after = capture(true)
        val original = before.root.children.single().accessibilityNodeInfo
        val current = after.root.children.single().accessibilityNodeInfo
        assertEquals(original, current)
        assertNotEquals(current, after.root.children.single().children.first().accessibilityNodeInfo)
        assertEquals("outer", (original as AccessibilityNodeInfo).viewIdResourceName)
    }

    @Test
    fun `captured platform scope survives eligibility loss through final click`() = actionTest {
        for (strict in listOf(false, true)) {
            var scrolls = 0
            var clicks = 0
            val ui = TaskUiScopeDefault(
                object : UiTreeInspector {
                    override suspend fun getCurrentUiElements() = error("unused")
                    override suspend fun getCurrentUiTree() = capture(scrolls > 0)
                    override suspend fun getCurrentWindowMetadata(): UiWindowMetadata? = null
                    override suspend fun getCurrentUiHierarchyDump(): String? = null
                },
                object : UiTreeFilterer {
                    override fun filterOnScreenOnly(uiTree: UiTree) = uiTree
                },
                proxy<UiTreeFormatter> { _, _ -> error("unused") },
                proxy<UiTreeManager> { method, arguments ->
                    val selected = arguments!![0] as androperator.uitree.UiNode
                    val platformNode = selected.accessibilityNodeInfo as AccessibilityNodeInfo
                    when (method) {
                        "swipeWithinVertical" -> {
                            assertEquals("outer", platformNode.viewIdResourceName)
                            scrolls++
                        }
                        "triggerClick" -> {
                            assertEquals("target", platformNode.viewIdResourceName)
                            clicks++
                        }
                        else -> error("Unexpected dispatch: $method")
                    }
                    true
                },
                backgroundScope,
            )
            ui.clickAfterScroll(NodeMatcher(resourceId = "target"),
                container = if (strict) NodeMatcher(resourceId = "outer") else null,
                strict = strict, settleDelay = Duration.ZERO, scrollRetry = TaskRetry.None, clickRetry = TaskRetry.None)
            assertEquals(1, scrolls)
            assertEquals(1, clicks)
        }
    }

    private inline fun <reified T> proxy(crossinline handler: (String, Array<out Any?>?) -> Any?): T =
        Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, method, arguments ->
            handler(method.name, arguments)
        } as T
}
