package androperator.uitree

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class UiTreeAsciiParserTest {
    @Test
    fun `create UiTree from partial ascii and infer OFF state`() {
        val ascii =
            """
            ├── └── └── └── └── └── └── └── └── └── ├── listitem [#18] @(48,321 984×1140) [0,0]
            ├── └── └── └── └── └── └── └── └── └── ├── └── unknown [com.google.android.apps.chromecast.app:id/hero_vertical_toggle] @(48,321 984×1140)
            ├── └── └── └── └── └── └── └── └── └── ├── └── └── unknown [com.google.android.apps.chromecast.app:id/toggle] @(270,321 540×1140)
            ├── └── └── └── └── └── └── └── └── └── ├── └── └── ├── button: "On" @(270,321 540×570) (clickable)
            ├── └── └── └── └── └── └── └── └── └── ├── └── └── └── button: "Off" @(270,891 540×570) (checked) (selected)
            """.trimIndent()

        val tree = UiTree(ascii)
        assertEquals(ToggleState.Off, tree.inferOnOffState())
    }

    @Test
    fun `create UiTree from partial ascii and infer ON state`() {
        val ascii =
            """
            ├── └── └── └── └── └── └── └── └── └── ├── listitem [#18] @(48,321 984×1140) [0,0]
            ├── └── └── └── └── └── └── └── └── └── ├── └── unknown [com.google.android.apps.chromecast.app:id/hero_vertical_toggle] @(48,321 984×1140)
            ├── └── └── └── └── └── └── └── └── └── ├── └── └── unknown [com.google.android.apps.chromecast.app:id/toggle] @(270,321 540×1140)
            ├── └── └── └── └── └── └── └── └── └── ├── └── └── ├── button: "On" @(270,321 540×570) (clickable) (selected)
            ├── └── └── └── └── └── └── └── └── └── ├── └── └── └── button: "Off" @(270,891 540×570) (clickable)
            """.trimIndent()

        val tree = UiTree(ascii)
        assertEquals(ToggleState.On, tree.inferOnOffState())
    }

    @Test
    fun `create UiTree from partial ascii with no toggle state`() {
        val ascii =
            """
            ├── └── └── └── └── └── └── └── └── └── ├── listitem [#18] @(48,321 984×1140) [0,0]
            ├── └── └── └── └── └── └── └── └── └── ├── └── text: "Some text" @(48,321 984×1140)
            ├── └── └── └── └── └── └── └── └── └── ├── └── button: "Cancel" @(270,321 540×570) (clickable)
            """.trimIndent()

        val tree = UiTree(ascii)
        assertEquals(ToggleState.Unknown, tree.inferOnOffState())
    }

    @Test
    fun `parse ascii correctly extracts node properties`() {
        val ascii =
            """
            ├── button: "Click Me" [com.example:id/button] @(100,200 300×100) (clickable)
            ├── text: "Some Text" @(50,50 200×50)
            └── unknown [com.example:id/container] @(0,0 400×400) (selected)
            """.trimIndent()

        val tree = UiTree(ascii, windowId = 1)

        // Should have a synthetic root with 3 children
        assertEquals(3, tree.root.children.size)

        val button = tree.root.children[0]
        assertEquals(UiRole.Button, button.role)
        assertEquals("Click Me", button.label)
        assertEquals("com.example:id/button", button.resourceId)
        assertTrue(button.isClickable)
        assertEquals(100f, button.bounds.left)
        assertEquals(200f, button.bounds.top)
        assertEquals(400f, button.bounds.right) // left + width
        assertEquals(300f, button.bounds.bottom) // top + height

        val text = tree.root.children[1]
        assertEquals(UiRole.Text, text.role)
        assertEquals("Some Text", text.label)

        val container = tree.root.children[2]
        assertEquals(UiRole.Unknown, container.role)
        assertEquals("com.example:id/container", container.resourceId)
        assertEquals("true", container.hints["selected"])
    }

    @Test
    fun `infer toggle state in specific container`() {
        val ascii =
            """
            ├── container [com.example:id/other_container] @(0,0 1080×1000)
            ├── └── button: "On" @(100,100 200×100) (clickable) (selected)
            ├── └── button: "Off" @(100,200 200×100) (clickable)
            ├── container [com.example:id/toggle_container] @(0,1000 1080×1000)
            ├── └── button: "On" @(100,1100 200×100) (clickable)
            └── └── button: "Off" @(100,1200 200×100) (clickable) (checked)
            """.trimIndent()

        val tree = UiTree(ascii, windowId = 1)

        // Overall tree should show the first "On" as selected
        assertEquals(ToggleState.On, tree.inferOnOffState())

        // But in the specific toggle container, "Off" should be checked
        assertEquals(ToggleState.Off, tree.inferOnOffStateInContainer("com.example:id/toggle_container"))
    }

    @Test
    fun `parse empty or malformed ascii gracefully`() {
        val emptyTree = UiTree("", windowId = 1)
        assertEquals(0, emptyTree.root.children.size)

        val malformedTree = UiTree("some random text without tree structure", windowId = 1)
        assertEquals(0, malformedTree.root.children.size)
    }

    @Test
    fun `coordinates in brackets are not resource ids`() {
        val ascii = """└── listitem @(0,0 100×100) [1,0]"""
        val tree = UiTree(ascii)
        assertEquals(
            null,
            tree.root.children
                .first()
                .resourceId,
        )
    }

    @Test
    fun `parse realistic Google Home toggle snippet`() {
        // This is based on the actual log output from the user's example
        val ascii =
            """
            ├── └── └── └── └── └── └── └── └── └── ├── listitem [#18] @(48,321 984×1140) [0,0]
            ├── └── └── └── └── └── └── └── └── └── ├── └── unknown [#19] [com.google.android.apps.chromecast.app:id/hero_vertical_toggle] @(48,321 984×1140)
            ├── └── └── └── └── └── └── └── └── └── ├── └── └── unknown [#20] [com.google.android.apps.chromecast.app:id/toggle] @(270,321 540×1140)
            ├── └── └── └── └── └── └── └── └── └── ├── └── └── ├── button [#21]: "On" @(270,321 540×570) (clickable)
            ├── └── └── └── └── └── └── └── └── └── ├── └── └── └── button [#22]: "Off" @(270,891 540×570) (checked) (selected)
            └── └── └── └── └── └── └── └── └── └── └── listitem [#23]: "Fan speed Low" [com.google.android.apps.chromecast.app:id/action_tile] @(48,1605 984×216) (clickable) [1,0]
            """.trimIndent()

        val tree = UiTree(ascii)

        // Should correctly identify that "Off" is selected
        assertEquals(ToggleState.Off, tree.inferOnOffState())

        // Should find the toggle container
        val toggleContainer = UiTreeTraversal.findByResourceId(tree, "com.google.android.apps.chromecast.app:id/toggle")
        assertNotNull(toggleContainer)

        // Should find both On and Off buttons
        val onButton = UiTreeTraversal.findByLabel(tree, "On")
        val offButton = UiTreeTraversal.findByLabel(tree, "Off")
        assertNotNull(onButton)
        assertNotNull(offButton)

        assertTrue(onButton.isClickable)
        // Note: In the real log output, the selected "Off" button doesn't have (clickable) attribute
        // assertTrue(offButton.isClickable)
        assertEquals("true", offButton.hints["checked"])
        assertEquals("true", offButton.hints["selected"])
    }
}
