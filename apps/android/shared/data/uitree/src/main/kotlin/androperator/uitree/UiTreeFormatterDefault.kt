package androperator.uitree

import kotlinx.serialization.json.Json

/**
 * Default implementation of UiTreeFormatter.
 * Provides ASCII tree formatting and JSON serialization.
 */
class UiTreeFormatterDefault : UiTreeFormatter {
    private val json =
        Json {
            prettyPrint = true
            encodeDefaults = true
        }

    override fun toAsciiTree(
        tree: UiTree,
        maxDepth: Int,
        omitRedundant: Boolean,
        showTreeIndex: Boolean,
        showId: Boolean,
        showClickable: Boolean,
        indexMap: Map<UiNodeId, Int>?,
    ): String {
        val builder = StringBuilder()
        builder.appendLine("UI Tree (Window: ${tree.windowId})")
        formatNodeAscii(tree.root, builder, "", 0, maxDepth, omitRedundant, showTreeIndex, showId, showClickable, indexMap)
        return builder.toString()
    }

    override fun toJson(tree: UiTree): String = json.encodeToString(tree)

    private fun normalizeText(text: String): String =
        text
            .replace("\n", "\\n")
            .replace("\r", "\\r")
            .replace("\t", "\\t")
            .replace("\"", "\\\"")

    private fun formatNodeAscii(
        node: UiNode,
        builder: StringBuilder,
        prefix: String,
        depth: Int,
        maxDepth: Int,
        omitRedundant: Boolean,
        showTreeIndex: Boolean,
        showId: Boolean,
        showClickable: Boolean,
        indexMap: Map<UiNodeId, Int>?,
    ) {
        if (depth >= maxDepth) {
            builder.appendLine("$prefix... (max depth reached)")
            return
        }

        // Skip redundant nodes if omitRedundant is enabled
        if (omitRedundant && node.hints["redundant"] == "true") {
            return
        }

        // Purity: don't modify node values; compute only derived values.
        val b = node.bounds
        val width = (b.right - b.left).toInt()
        val height = (b.bottom - b.top).toInt()
        val boundsText = " @(${b.left.toInt()},${b.top.toInt()} $width×$height)"

        val clickableText = if (showClickable && node.isClickable) " (clickable)" else ""
        val indexText = if (showTreeIndex) indexMap?.get(node.id)?.let { " [#${it + 1}]" } ?: "" else "" // +1 for 1-based display indexing
        val idText = if (showId) " id=${node.id}" else ""

        val roleText =
            when (node.role) {
                UiRole.Title -> "**${node.role.name.lowercase()}**"
                UiRole.Tab -> "tab"
                UiRole.Pager -> "pager"
                UiRole.Card -> "card"
                else -> node.role.name.lowercase()
            }

        val labelText = if (node.label.isNotBlank()) ": \"${normalizeText(node.label)}\"" else ""
        val resourceText = node.resourceId?.let { " [$it]" } ?: ""

        // State and collection hints
        val stateHints = formatStateHints(node.hints)
        val collectionInfo = formatCollectionInfo(node.hints)

        // Combine all parts
        val fullLine = "$prefix$roleText$indexText$idText$labelText$resourceText$boundsText$clickableText$stateHints$collectionInfo"
        builder.appendLine(fullLine)

        // Format children
        val childCount = node.children.size
        node.children.forEachIndexed { index, child ->
            val isLast = index == childCount - 1
            val childPrefix = prefix + if (isLast) "└── " else "├── "
            val nextPrefix = prefix + if (isLast) "    " else "│   "

            formatNodeAscii(child, builder, childPrefix, depth + 1, maxDepth, omitRedundant, showTreeIndex, showId, showClickable, indexMap)
        }
    }

    private fun formatStateHints(hints: Map<String, String>): String {
        val stateParts = mutableListOf<String>()

        // Check state
        if (hints["checked"] == "true") stateParts.add("(checked)")
        if (hints["selected"] == "true") stateParts.add("(selected)")
        if (hints["scrollable"] == "true") stateParts.add("(scrollable)")
        if (hints["disabled"] == "true") stateParts.add("(disabled)")

        return if (stateParts.isNotEmpty()) " ${stateParts.joinToString(" ")}" else ""
    }

    private fun formatCollectionInfo(hints: Map<String, String>): String {
        val collectionParts = mutableListOf<String>()

        // Collection dimensions
        val rows = hints["collection_rows"]
        val cols = hints["collection_columns"]
        if (rows != null && cols != null) {
            collectionParts.add("($rows×$cols)")
        }

        // Item position
        val row = hints["item_row"]
        val col = hints["item_column"]
        if (row != null && col != null) {
            collectionParts.add("[$row,$col]")
        }

        return if (collectionParts.isNotEmpty()) " ${collectionParts.joinToString(" ")}" else ""
    }
}
