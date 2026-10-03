package androperator.uitree

import android.app.Application
import android.view.accessibility.AccessibilityNodeInfo
import androperator.accessibilityservice.buildUiTree
import androperator.accessibilityservice.readAccessibilityDataSensitive
import androperator.accessibilityservice.toUiAutomatorHierarchyDump
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowAccessibilityNodeInfo
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, application = Application::class)
class AccessibilitySensitivityTest {
    @Implements(AccessibilityNodeInfo::class)
    class UnreadableSensitivityNode : ShadowAccessibilityNodeInfo() {
        @Implementation
        fun isAccessibilityDataSensitive(): Boolean = throw IllegalStateException("Node state unavailable")
    }

    @Test
    @Config(sdk = [34], shadows = [UnreadableSensitivityNode::class])
    fun `failed sensitivity read remains unknown without losing the node`() {
        val node = AccessibilityNodeInfo.obtain()
        node.text = "Control"
        assertEquals(null, node.readAccessibilityDataSensitive())
        val captured = node.buildUiTree(1).root
        assertEquals("Control", captured.label)
        assertEquals(null, captured.accessibilityDataSensitive)
        assertFalse(node.toUiAutomatorHierarchyDump().contains("accessibility-data-sensitive"))
    }

    @Test
    @Config(sdk = [33])
    fun `older platform leaves query and XML sensitivity unknown`() {
        val node = AccessibilityNodeInfo.obtain()
        assertEquals(null, node.readAccessibilityDataSensitive())
        assertEquals(null, node.buildUiTree(1).root.accessibilityDataSensitive)
        assertFalse(node.toUiAutomatorHierarchyDump().contains("accessibility-data-sensitive"))
    }

    @Test
    @Config(sdk = [34])
    fun `known platform values survive tree and XML capture`() {
        val node = AccessibilityNodeInfo.obtain()
        for (value in listOf(true, false)) {
            node.isAccessibilityDataSensitive = value
            assertEquals(value, node.readAccessibilityDataSensitive())
            assertEquals(value, node.buildUiTree(1).root.accessibilityDataSensitive)
            assertTrue(node.toUiAutomatorHierarchyDump().contains("accessibility-data-sensitive=\"$value\""))
        }
    }
}
