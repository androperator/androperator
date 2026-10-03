package androperator.task.runner

import action.math.geometry.Rect
import action.system.window.WindowFrameManagerNoOp
import androperator.uitree.UiNode
import androperator.uitree.UiNodeId
import androperator.uitree.UiRole
import androperator.uitree.UiTree
import androperator.uitree.UiTreeFiltererDefault
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class NodeResolverTest {
    private fun node(
        label: String = "",
        id: String = "duplicate",
        visible: Boolean = true,
        sensitivity: Boolean? = null,
        children: List<UiNode> = emptyList(),
        hints: Map<String, String> = emptyMap(),
        bounds: Rect = Rect(10f, 30f, 110f, 130f),
    ) = UiNode(
        id = UiNodeId("duplicate-internal-id"),
        role = UiRole.Switch,
        label = label,
        className = "android.widget.Switch",
        bounds = bounds,
        isClickable = true,
        isEnabled = false,
        isVisible = visible,
        resourceId = id,
        children = children,
        hints = hints,
        accessibilityDataSensitive = sensitivity,
    )

    private fun resolver(root: UiNode): NodeResolver = NodeResolver(UiTreeFiltererDefault(WindowFrameManagerNoOp).filterOnScreenOnly(UiTree(root)))

    @Test
    fun `sensitivity remains per node through filtering relationships and limits`() {
        val root =
            node(
                "Root",
                sensitivity = true,
                children = listOf(node(sensitivity = false), node(sensitivity = null), node(sensitivity = true, visible = false)),
            )
        val resolver = resolver(root)
        val all = Json.parseToJsonElement(resolver.query(null, "all")).jsonObject
        assertEquals(1, all.getValue("schemaVersion").jsonPrimitive.int)
        assertEquals(
            listOf("true", "false", "null", "true"),
            all.getValue("nodes").jsonArray.map { it.jsonObject.getValue("accessibilityDataSensitive").toString() },
        )
        val filtered = Json.parseToJsonElement(resolver.query(NodeMatcher(ancestor = NodePredicate(textEquals = "Root")), limit = 1)).jsonObject
        assertEquals(2, filtered.getValue("totalMatches").jsonPrimitive.int)
        assertEquals("false", filtered.getValue("nodes").jsonArray.single().jsonObject.getValue("accessibilityDataSensitive").toString())
    }

    @Test
    fun `blank controls count and false differs from unknown with stable raw paths`() {
        val root =
            node(
                id = "root",
                children =
                    listOf(
                        node("Hidden", visible = false),
                        node(hints = mapOf("checked" to "false", "checkable" to "true", "selected" to "false", "scrollable" to "false")),
                        node(),
                    ),
            )
        val query = Json.parseToJsonElement(resolver(root).query(NodeMatcher(resourceId = "duplicate"))).jsonObject
        assertEquals(2, query.getValue("totalMatches").jsonPrimitive.int)
        assertEquals(2, resolver(root).resolve(NodeMatcher(resourceId = "duplicate", textEquals = "")).size)
        val nodes = query.getValue("nodes").jsonArray.map { it.jsonObject }
        assertEquals(listOf("0.1", "0.2"), nodes.map { it.getValue("nodePath").jsonPrimitive.content })
        assertEquals(listOf("", ""), nodes.map { it.getValue("label").jsonPrimitive.content })
        assertFalse(nodes[0].getValue("checked").jsonPrimitive.boolean)
        assertEquals(JsonNull, nodes[1].getValue("checked"))
        assertEquals("0", nodes[1].getValue("parentPath").jsonPrimitive.content)
        assertEquals(
            0,
            Json
                .parseToJsonElement(resolver(root).query(NodeMatcher(textEquals = "missing")))
                .jsonObject
                .getValue("totalMatches")
                .jsonPrimitive.int,
        )
    }

    @Test
    fun `relationships use AND strict ancestry and eligible descendants`() {
        val root =
            node(
                "Root",
                id = "root",
                children =
                    listOf(
                        node("First", children = listOf(node("Unique A"))),
                        node("Second", children = listOf(node("Unique B"), node("Stale", visible = false))),
                    ),
            )
        val resolver = resolver(root)
        val matcher = NodeMatcher(resourceId = "duplicate", ancestor = NodePredicate(textEquals = "Root"), descendant = NodePredicate(textEquals = "Unique B"))
        assertEquals(listOf("0.1"), resolver.resolve(matcher).map { it.nodePath })
        assertTrue(resolver.resolve(matcher.copy(ancestor = NodePredicate(textEquals = "Second"))).isEmpty())
        assertTrue(resolver.resolve(NodeMatcher(textEquals = "Second", descendant = NodePredicate(textEquals = "Second"))).isEmpty())
        assertTrue(resolver.resolve(NodeMatcher(textEquals = "Second", descendant = NodePredicate(textEquals = "Stale"))).isEmpty())
        assertEquals(1, resolver.resolve(NodeMatcher(textEquals = "Second", descendant = NodePredicate(textEquals = "Stale")), "all").size)
        assertTrue(resolver.resolve(matcher.copy(textEquals = "First")).isEmpty())
    }

    @Test
    fun `pruning an ancestor prunes visible children and preserves legacy root eligibility`() {
        val root = node("Root", children = listOf(node("Hidden ancestor", visible = false, children = listOf(node("Visible child")))))
        val resolver = resolver(root)
        assertTrue(resolver.resolve(NodeMatcher(textEquals = "Visible child")).isEmpty())
        assertEquals(1, resolver.resolve(NodeMatcher(textEquals = "Visible child", ancestor = NodePredicate(textEquals = "Hidden ancestor")), "all").size)
        val all =
            Json
                .parseToJsonElement(resolver.query(null, "all"))
                .jsonObject
                .getValue("nodes")
                .jsonArray
        assertFalse(
            all[2]
                .jsonObject
                .getValue("onScreen")
                .jsonPrimitive.boolean,
        )
        assertTrue(
            all[2]
                .jsonObject
                .getValue("visibleToUser")
                .jsonPrimitive.boolean,
        )
        assertEquals(1, resolver(node(visible = false, children = listOf(node()))).resolve(null).size)
    }

    @Test
    fun `bounds filtering limit and observation identity are truthful`() {
        val root = node(children = listOf(node(bounds = Rect(99999f, 99999f, 100000f, 100000f)), node(), node()))
        val resolver = resolver(root)
        val first = Json.parseToJsonElement(resolver.query(null, limit = 2)).jsonObject
        val second = Json.parseToJsonElement(resolver.query(null, limit = 2)).jsonObject
        assertEquals(3, first.getValue("totalMatches").jsonPrimitive.int)
        assertEquals(2, first.getValue("returnedCount").jsonPrimitive.int)
        assertTrue(first.getValue("truncated").jsonPrimitive.boolean)
        assertNotEquals(first["snapshotId"], second["snapshotId"])
        assertEquals(JsonNull, first.getValue("nodes").jsonArray[0].jsonObject["parentPath"])
        assertEquals(4, resolver.resolve(null, "all").size)
    }

    @Test
    fun `subtree resolution retains ancestors outside the container`() {
        val root = node("Structural ancestor", children = listOf(node("Container", children = listOf(node("Target")))))
        val tree = UiTreeFiltererDefault(WindowFrameManagerNoOp).filterOnScreenOnly(UiTree(root))
        val subtree = tree.copy(root = tree.root.children[0])
        val matches = NodeResolver(subtree).resolve(NodeMatcher(textEquals = "Target", ancestor = NodePredicate(textEquals = "Structural ancestor")))
        assertEquals(listOf("0.0.0"), matches.map { it.nodePath })
    }

    @Test
    fun `repeated filtering preserves paths and platform clickability differs from inherited clickability`() {
        val root = node(children = listOf(node(visible = false), node(hints = mapOf("clickable" to "false"))))
        val filterer = UiTreeFiltererDefault(WindowFrameManagerNoOp)
        val filtered = filterer.filterOnScreenOnly(filterer.filterOnScreenOnly(UiTree(root)))
        val query = Json.parseToJsonElement(NodeResolver(filtered).query(null)).jsonObject
        val child = query.getValue("nodes").jsonArray[1].jsonObject
        assertEquals("0.1", child.getValue("nodePath").jsonPrimitive.content)
        assertFalse(child.getValue("clickable").jsonPrimitive.boolean)
        assertTrue(
            filtered.root.children
                .single()
                .isClickable,
        )
    }

    @Test
    fun `unavailable platform state remains null`() {
        val result = Json.parseToJsonElement(resolver(node(sensitivity = true, hints = mapOf("stateUnavailable" to "true"))).query(null)).jsonObject
        val node =
            result
                .getValue("nodes")
                .jsonArray
                .single()
                .jsonObject
        for (field in listOf("visibleToUser", "enabled", "clickable", "checked", "checkable", "selected", "scrollable", "accessibilityDataSensitive")) {
            assertEquals(JsonNull, node[field], field)
        }
    }

    @Test
    fun `response guard measures UTF8 bytes and never truncates serialized JSON`() {
        val resolver = resolver(node(children = List(100) { node("界".repeat(1000)) }))
        assertFailsWith<QueryPayloadTooLargeException> { resolver.query(null, "all", 1000) }
        val smaller = Json.parseToJsonElement(resolver.query(null, "all", 1)).jsonObject
        assertTrue(smaller.getValue("truncated").jsonPrimitive.boolean)
        assertEquals(101, smaller.getValue("totalMatches").jsonPrimitive.int)
    }
}
