package androperator.uitree

import action.math.geometry.Rect

/**
 * Example usage of the hierarchical UiTree API.
 * This demonstrates how to use the new hierarchical structure.
 */
object UiTreeExample {
    /**
     * Example of how to use the UiTreeFormatter to format trees for LLMs.
     */
    fun formatTreeExample(tree: UiTree): String {
        val formatter = UiTreeFormatterDefault()
        return formatter.toAsciiTree(tree)
    }

    /**
     * Example of how to traverse the tree and collect specific types of nodes.
     */
    fun findClickableElements(tree: UiTree): List<UiNode> {
        val clickableNodes = mutableListOf<UiNode>()

        fun traverse(node: UiNode) {
            if (node.isClickable) {
                clickableNodes.add(node)
            }
            node.children.forEach { traverse(it) }
        }

        traverse(tree.root)
        return clickableNodes
    }

    /**
     * Example of how to find nodes by role.
     */
    fun findNodesByRole(
        tree: UiTree,
        role: UiRole,
    ): List<UiNode> {
        val matchingNodes = mutableListOf<UiNode>()

        fun traverse(node: UiNode) {
            if (node.role == role) {
                matchingNodes.add(node)
            }
            node.children.forEach { traverse(it) }
        }

        traverse(tree.root)
        return matchingNodes
    }

    /**
     * Example of creating a simple tree for testing.
     */
    fun createSampleTree(): UiTree {
        val button1 =
            UiNode(
                id = UiNodeId("1:0"),
                role = UiRole.Button,
                label = "OK",
                className = "android.widget.Button",
                bounds = Rect(100f, 200f, 200f, 250f),
                isClickable = true,
                isEnabled = true,
                isVisible = true,
            )

        val button2 =
            UiNode(
                id = UiNodeId("1:1"),
                role = UiRole.Button,
                label = "Cancel",
                className = "android.widget.Button",
                bounds = Rect(250f, 200f, 350f, 250f),
                isClickable = true,
                isEnabled = true,
                isVisible = true,
            )

        val container =
            UiNode(
                id = UiNodeId("1:"),
                role = UiRole.Container,
                label = "",
                className = "android.widget.LinearLayout",
                bounds = Rect(50f, 150f, 400f, 300f),
                isClickable = false,
                isEnabled = true,
                isVisible = true,
                children = listOf(button1, button2),
            )

        return UiTree(root = container)
    }

    /**
     * Example showing improved SwitchBot-style navigation with tabs and pager.
     * Demonstrates the new role inference and formatting improvements.
     */
    fun createSwitchBotStyleTree(): UiTree {
        // Bottom navigation tabs
        val homeTab =
            UiNode(
                id = UiNodeId("3:0.0"),
                role = UiRole.Tab,
                label = "Home",
                className = "android.widget.LinearLayout",
                bounds = Rect(0f, 800f, 180f, 880f),
                isClickable = true,
                isEnabled = true,
                isVisible = true,
                resourceId = "mainTabs",
                hints = mapOf("selected" to "true"),
            )

        val automationTab =
            UiNode(
                id = UiNodeId("3:0.1"),
                role = UiRole.Tab,
                label = "Automation",
                className = "android.widget.LinearLayout",
                bounds = Rect(180f, 800f, 360f, 880f),
                isClickable = true,
                isEnabled = true,
                isVisible = true,
                resourceId = "mainTabs",
            )

        val shopTab =
            UiNode(
                id = UiNodeId("3:0.2"),
                role = UiRole.Tab,
                label = "Shop",
                className = "android.widget.LinearLayout",
                bounds = Rect(360f, 800f, 540f, 880f),
                isClickable = true,
                isEnabled = true,
                isVisible = true,
                resourceId = "mainTabs",
            )

        val profileTab =
            UiNode(
                id = UiNodeId("3:0.3"),
                role = UiRole.Tab,
                label = "Profile",
                className = "android.widget.LinearLayout",
                bounds = Rect(540f, 800f, 720f, 880f),
                isClickable = true,
                isEnabled = true,
                isVisible = true,
                resourceId = "mainTabs",
            )

        // Tab bar container
        val tabBar =
            UiNode(
                id = UiNodeId("3:0"),
                role = UiRole.TabBar,
                label = "",
                className = "com.google.android.material.tabs.TabLayout",
                bounds = Rect(0f, 800f, 720f, 880f),
                isClickable = false,
                isEnabled = true,
                isVisible = true,
                resourceId = "mainTabs",
                children = listOf(homeTab, automationTab, shopTab, profileTab),
            )

        // Grid content (representing home screen devices)
        val deviceGrid =
            UiNode(
                id = UiNodeId("3:1"),
                role = UiRole.Grid,
                label = "",
                className = "androidx.recyclerview.widget.RecyclerView",
                bounds = Rect(0f, 0f, 720f, 750f),
                isClickable = false,
                isEnabled = true,
                isVisible = true,
                hints = mapOf("collection_rows" to "4", "collection_columns" to "2"),
            )

        // Root container
        val root =
            UiNode(
                id = UiNodeId("3:"),
                role = UiRole.Container,
                label = "",
                className = "androidx.constraintlayout.widget.ConstraintLayout",
                bounds = Rect(0f, 0f, 720f, 880f),
                isClickable = false,
                isEnabled = true,
                isVisible = true,
                children = listOf(deviceGrid, tabBar),
            )

        return UiTree(root = root)
    }
}
