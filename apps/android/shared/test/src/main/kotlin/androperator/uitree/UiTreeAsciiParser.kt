package androperator.uitree

import action.math.geometry.Rect

/**
 * Parser for converting ASCII UI tree output (from logUiTree()) back into UiTree instances.
 * This enables testing of UI tree logic without requiring live device interaction.
 */
object UiTreeAsciiParser {
    /**
     * Regex pattern for matching Android resource IDs in the format [package:type/name].
     * - package: [a-zA-Z0-9_.]+ (e.g., com.example, androidx.core)
     * - type: [a-zA-Z0-9_.]+ (e.g., id, string, drawable)
     * - name: [a-zA-Z0-9_.]+ (e.g., button_submit, main_activity)
     * Example: [com.example:id/button_submit], [android:id/content]
     */
    private const val ANDROID_RESOURCE_ID_PATTERN = """\[([a-zA-Z0-9_.]+:[a-zA-Z0-9_.]+/[a-zA-Z0-9_.]+)\]"""

    private val depthTokenRegex = Regex("""(└── |├── )""")
    private val boundsRegex = Regex("""@\(([-\d]+),([-\d]+) (\d+)×(\d+)\)""")
    private val labelRegex = Regex(""":\s*"([^"]*)"""")
    private val resourceRegex = Regex(ANDROID_RESOURCE_ID_PATTERN)
    private val indexRegex = Regex("""\[#\d+]""")

    private fun roleFrom(line: String): UiRole =
        when {
            line.startsWith("container") -> UiRole.Container
            line.startsWith("row") -> UiRole.Row
            line.startsWith("column") -> UiRole.Column
            line.startsWith("toolbar") -> UiRole.Toolbar
            line.startsWith("tabbar") -> UiRole.TabBar
            line.startsWith("listitem") -> UiRole.ListItem
            line.startsWith("list") -> UiRole.List
            line.startsWith("grid") -> UiRole.Grid
            line.startsWith("pager") -> UiRole.Pager
            line.startsWith("tab") -> UiRole.Tab
            line.startsWith("card") -> UiRole.Card
            line.startsWith("button") -> UiRole.Button
            line.startsWith("textfield") -> UiRole.TextField
            line.startsWith("switch") -> UiRole.Switch
            line.startsWith("checkbox") -> UiRole.Checkbox
            line.startsWith("radio") -> UiRole.Radio
            line.startsWith("toggle") -> UiRole.Toggle
            line.startsWith("icon") -> UiRole.Icon
            line.startsWith("image") -> UiRole.Image
            line.startsWith("chip") -> UiRole.Chip
            line.startsWith("menuitem") -> UiRole.MenuItem
            line.startsWith("menu") -> UiRole.Menu
            line.startsWith("text") -> UiRole.Text
            line.startsWith("label") -> UiRole.Label
            line.startsWith("title") -> UiRole.Title
            else -> UiRole.Unknown
        }

    data class ParsedLine(
        val depth: Int,
        val role: UiRole,
        val label: String,
        val resourceId: String?,
        val bounds: Rect,
        val clickable: Boolean,
        val checked: Boolean,
        val selected: Boolean,
        val disabled: Boolean,
    )

    private fun parseLine(raw: String): ParsedLine? {
        val line = raw.trimStart()

        // Only process lines that contain tree structure tokens or look like UI tree entries
        val hasBranchTokens = depthTokenRegex.containsMatchIn(raw)
        val looksLikeUIEntry = raw.contains("@(") && raw.contains("×") // bounds pattern

        if (!hasBranchTokens && !looksLikeUIEntry) {
            return null
        }

        // Compute depth by counting occurrences of branch tokens anywhere on the line
        val depth = depthTokenRegex.findAll(raw).count()

        // Extract after the last branch token to get the "payload" start
        val payloadStart =
            raw
                .lastIndexOf("└── ")
                .let { a ->
                    val b = raw.lastIndexOf("├── ")
                    maxOf(a, b)
                }.let { idx -> if (idx == -1) 0 else idx + 4 }

        val payload = raw.drop(payloadStart).trimStart()
        if (payload.isBlank()) return null

        val roleName = payload.substringBefore(' ')
        val role = roleFrom(roleName.lowercase())

        val label =
            labelRegex
                .find(payload)
                ?.groupValues
                ?.get(1)
                .orEmpty()

        // Extract Android resource ID (e.g., com.example:id/button)
        val resourceId = resourceRegex.find(payload)?.groupValues?.get(1)

        val boundsMatch = boundsRegex.find(payload)
        val bounds =
            if (boundsMatch != null) {
                val (l, t, w, h) = boundsMatch.destructured
                val left = l.toFloat()
                val top = t.toFloat()
                val width = w.toFloat()
                val height = h.toFloat()
                Rect(left, top, left + width, top + height)
            } else {
                Rect.Zero
            }

        val clickable = payload.contains("(clickable)")
        val checked = payload.contains("(checked)")
        val selected = payload.contains("(selected)")
        val disabled = payload.contains("(disabled)")

        return ParsedLine(depth, role, label, resourceId, bounds, clickable, checked, selected, disabled)
    }

    /**
     * Parses ASCII UI tree output into a UiTree instance.
     * Supports parsing partial tree snippets by creating a synthetic root.
     *
     * @param ascii The ASCII tree output from logUiTree(), can be partial
     * @param windowId Window ID to assign to the created tree
     * @return UiTree instance representing the parsed hierarchy
     */
    fun parse(
        ascii: String,
        windowId: Int = -1,
    ): UiTree {
        // Make a synthetic root; we'll build children by depth stack.
        val root =
            UiNode(
                id = UiNodeId("$windowId:"),
                role = UiRole.Container,
                label = "",
                className = "synthetic.Root",
                bounds = Rect.Zero,
                isClickable = false,
                isEnabled = true,
                isVisible = true,
                children = emptyList(),
            )
        val stack = ArrayDeque<UiNode>()
        stack.add(root)
        val childrenMap = mutableMapOf<UiNode, MutableList<UiNode>>().apply { put(root, mutableListOf()) }

        ascii
            .lineSequence()
            .mapNotNull { parseLine(it) }
            .forEachIndexed { idx, pl ->
                // shrink/expand stack to current depth+1 (root at depth 0)
                while (stack.size > pl.depth + 1) stack.removeLast()
                while (stack.size < pl.depth + 1) stack.add(stack.last()) // Pad with last element for gaps

                val id = UiNodeId("$windowId:${pl.depth}.$idx") // stable-enough for tests
                val node =
                    UiNode(
                        id = id,
                        role = pl.role,
                        label = pl.label,
                        className = "synthetic.${pl.role.name}",
                        bounds = pl.bounds,
                        isClickable = pl.clickable,
                        isEnabled = true,
                        isVisible = true,
                        resourceId = pl.resourceId,
                        hints =
                            buildMap {
                                if (pl.checked) put("checked", "true")
                                if (pl.selected) put("selected", "true")
                                if (pl.disabled) put("disabled", "true")
                            },
                    )

                val parent = stack.last()
                childrenMap.getOrPut(parent) { mutableListOf() }.add(node)
                childrenMap.putIfAbsent(node, mutableListOf())

                // push node as the new current depth parent for any deeper children
                stack.addLast(node)
            }

        // stitch children recursively
        fun attach(node: UiNode): UiNode {
            val kids = childrenMap[node]?.map { attach(it) }.orEmpty()
            return node.copy(children = kids)
        }

        return UiTree(root = attach(root), windowId = windowId)
    }
}
