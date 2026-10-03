package androperator.uitree

import action.math.geometry.Rect
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class UiTreeFormatterTest {
    private val formatter = UiTreeFormatterDefault()

    @Test
    fun `formatNodeAscii includes (disabled) for disabled nodes via hints system`() {
        // Create a disabled button node
        val disabledButton =
            UiNode(
                id = UiNodeId.create(windowId = 1, indexPath = intArrayOf(0)),
                role = UiRole.Button,
                label = "Submit",
                className = "Button",
                bounds = Rect(0f, 0f, 100f, 50f),
                isClickable = true,
                isEnabled = false, // This node is disabled
                isVisible = true,
                hints = mapOf("disabled" to "true"), // Hints should include disabled
            )

        // Create a tree with this node
        val tree = UiTree(root = disabledButton)

        // Format as ASCII
        val asciiOutput = formatter.toAsciiTree(tree)

        // Verify that (disabled) appears in the output
        assertTrue(asciiOutput.contains("(disabled)"), "ASCII output should contain '(disabled)' for disabled nodes")
    }

    @Test
    fun `formatNodeAscii does not include (disabled) for enabled nodes`() {
        // Create an enabled button node
        val enabledButton =
            UiNode(
                id = UiNodeId.create(windowId = 1, indexPath = intArrayOf(0)),
                role = UiRole.Button,
                label = "Submit",
                className = "Button",
                bounds = Rect(0f, 0f, 100f, 50f),
                isClickable = true,
                isEnabled = true, // This node is enabled
                isVisible = true,
                hints = emptyMap(), // No disabled hint
            )

        // Create a tree with this node
        val tree = UiTree(root = enabledButton)

        // Format as ASCII
        val asciiOutput = formatter.toAsciiTree(tree)

        // Verify that (disabled) does NOT appear in the output
        assertFalse(asciiOutput.contains("(disabled)"), "ASCII output should NOT contain '(disabled)' for enabled nodes")
    }

    @Test
    fun `formatStateHints includes (disabled) when disabled hint is present`() {
        val hintsWithDisabled = mapOf("disabled" to "true", "checked" to "true")
        val formatted =
            (formatter as UiTreeFormatterDefault).run {
                // Use reflection or create a test helper to access private method
                // For now, we'll test the overall behavior through public API
                val node =
                    UiNode(
                        id = UiNodeId.create(windowId = 1, indexPath = intArrayOf(0)),
                        role = UiRole.Button,
                        label = "Test",
                        className = "Button",
                        bounds = Rect(0f, 0f, 100f, 50f),
                        isClickable = true,
                        isEnabled = false,
                        isVisible = true,
                        hints = hintsWithDisabled,
                    )
                val tree = UiTree(root = node)
                formatter.toAsciiTree(tree)
            }

        assertTrue(formatted.contains("(disabled)"), "State hints should include '(disabled)' when hint is present")
        assertTrue(formatted.contains("(checked)"), "State hints should still include other states")
    }
}
