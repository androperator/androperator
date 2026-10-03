package androperator.task.runner

import androperator.uitree.UiNode
import androperator.uitree.UiTree
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.util.UUID

/** Resolves fresh candidates against structural context and source-owned visibility. */
class NodeResolver(
    private val tree: UiTree,
) {
    data class Candidate(
        val node: UiNode,
        val nodePath: String,
        val ancestors: List<UiNode>,
    )

    private val original = mutableListOf<Candidate>()
    private val eligible = linkedMapOf<String, UiNode>()

    init {
        fun index(
            node: UiNode,
            path: String,
            ancestors: List<UiNode>,
        ) {
            original.add(Candidate(node, path, ancestors))
            node.children.forEachIndexed { childIndex, child -> index(child, "$path.$childIndex", ancestors + node) }
        }

        fun indexEligible(
            node: UiNode,
            path: String,
        ) {
            val sourcePath = node.sourcePath ?: path
            eligible[sourcePath] = node
            node.children.forEachIndexed { childIndex, child -> indexEligible(child, "$sourcePath.$childIndex") }
        }
        index(tree.sourceRoot ?: tree.root, "0", emptyList())
        indexEligible(tree.root, "0")
    }

    fun resolve(
        matcher: NodeMatcher?,
        visibility: String = "on_screen",
    ): List<Candidate> {
        require(visibility == "all" || visibility == "on_screen")
        val candidates = if (visibility == "all") original else original.filter { it.nodePath in eligible }
        return candidates
            .filter { candidate ->
                val node = candidate.node
                (
                    matcher == null ||
                        (
                            matcher.matches(node.asTaskUiNode()) &&
                                (matcher.ancestor == null || candidate.ancestors.any { matcher.ancestor.matches(it.asTaskUiNode()) }) &&
                                (
                                    matcher.descendant == null ||
                                        candidates.any {
                                            it.nodePath.startsWith("${candidate.nodePath}.") && matcher.descendant.matches(it.node.asTaskUiNode())
                                        }
                                )
                        )
                )
            }.map { candidate ->
                // Actions retain the filtered children used by their existing dispatch mechanisms.
                if (visibility == "on_screen") candidate.copy(node = eligible.getValue(candidate.nodePath)) else candidate
            }
    }

    fun query(
        matcher: NodeMatcher?,
        visibility: String = "on_screen",
        limit: Int = 100,
        snapshotId: String = UUID.randomUUID().toString(),
        capturedAt: String = queryCaptureTimestamp(),
    ): String {
        require(limit in 1..1000)
        val matches = resolve(matcher, visibility)
        return encodeMatches(matches, limit, snapshotId, capturedAt, Int.MAX_VALUE)
    }

    fun encodeMatches(
        matches: List<Candidate>,
        limit: Int = 10,
        snapshotId: String = UUID.randomUUID().toString(),
        capturedAt: String = queryCaptureTimestamp(),
        maxStringLength: Int = 512,
    ): String {
        val nodes =
            matches.take(limit).map { candidate ->
                val node = candidate.node
                val stateAvailable = node.hints["stateUnavailable"] != "true"
                NodeSummary(
                    nodePath = candidate.nodePath,
                    parentPath = candidate.nodePath.substringBeforeLast('.', "").ifEmpty { null },
                    resourceId = node.resourceId?.take(maxStringLength),
                    className = node.className.take(maxStringLength),
                    role = node.role.name.lowercase(),
                    label = node.label.take(maxStringLength),
                    contentDescription = node.contentDescription?.take(maxStringLength),
                    bounds = NodeBounds(node.bounds.left, node.bounds.top, node.bounds.right, node.bounds.bottom),
                    visibleToUser = node.isVisible.takeIf { stateAvailable },
                    onScreen = candidate.nodePath in eligible,
                    enabled = node.isEnabled.takeIf { stateAvailable },
                    clickable = (node.hints["clickable"]?.toBooleanStrictOrNull() ?: node.isClickable).takeIf { stateAvailable },
                    checkable = node.hints["checkable"]?.toBooleanStrictOrNull(),
                    checked = node.hints["checked"]?.toBooleanStrictOrNull(),
                    selected = node.hints["selected"]?.toBooleanStrictOrNull(),
                    accessibilityDataSensitive = node.accessibilityDataSensitive.takeIf { stateAvailable },
                    scrollable = node.hints["scrollable"]?.toBooleanStrictOrNull(),
                )
            }
        val encoded =
            queryJson.encodeToString(
                NodeQueryResult(
                    snapshotId = snapshotId,
                    capturedAt = capturedAt,
                    totalMatches = matches.size,
                    returnedCount = nodes.size,
                    truncated = matches.size > nodes.size,
                    nodes = nodes,
                ),
            )
        if (encoded.encodeToByteArray().size > 256 * 1024) throw QueryPayloadTooLargeException()
        return encoded
    }

    fun encodeNode(node: UiNode): String? {
        val candidate = resolve(null, "all").firstOrNull {
            it.node === node || (node.accessibilityNodeInfo != null && it.node.accessibilityNodeInfo == node.accessibilityNodeInfo)
                || (node.sourcePath != null && it.nodePath == node.sourcePath)
        } ?: return null
        return queryJson.parseToJsonElement(encodeMatches(listOf(candidate))).let {
            (it as kotlinx.serialization.json.JsonObject)["nodes"] as kotlinx.serialization.json.JsonArray
        }.first().toString()
    }

    private fun UiNode.asTaskUiNode() =
        TaskUiNode(
            resourceId = resourceId,
            label = label,
            contentDescription = contentDescription,
            clickable = isClickable,
            role = role.name.lowercase(),
            bounds = bounds,
            debugPath = id.value,
        )

    companion object {
        private val queryJson = Json { encodeDefaults = true }
    }
}

class QueryPayloadTooLargeException : IllegalStateException("Serialized data.query exceeds 256 KiB")

@Serializable
data class NodeBounds(
    val left: Float,
    val top: Float,
    val right: Float,
    val bottom: Float,
)

@Serializable
data class NodeSummary(
    val nodePath: String,
    val parentPath: String?,
    val resourceId: String?,
    val className: String,
    val role: String,
    val label: String,
    val contentDescription: String?,
    val bounds: NodeBounds,
    val visibleToUser: Boolean?,
    val onScreen: Boolean,
    val enabled: Boolean?,
    val clickable: Boolean?,
    val checkable: Boolean?,
    val checked: Boolean?,
    val selected: Boolean?,
    val scrollable: Boolean?,
    val accessibilityDataSensitive: Boolean?,
)

@Serializable
data class NodeQueryResult(
    val schemaVersion: Int = 1,
    val snapshotId: String,
    val capturedAt: String,
    val totalMatches: Int,
    val returnedCount: Int,
    val truncated: Boolean,
    val nodes: List<NodeSummary>,
)

/** API-21-compatible UTC wall time sampled immediately after the capture. */
internal fun queryCaptureTimestamp(): String =
    java.text
        .SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
        .apply {
            timeZone = java.util.TimeZone.getTimeZone("UTC")
        }.format(java.util.Date())
