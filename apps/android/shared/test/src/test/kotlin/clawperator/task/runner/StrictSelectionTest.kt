package clawperator.task.runner

import action.math.geometry.Rect
import clawperator.test.ActionTest
import clawperator.test.actionTest
import clawperator.uitree.*
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.serialization.json.*
import java.lang.reflect.Proxy
import kotlin.test.*
import kotlin.time.Duration.Companion.milliseconds

class StrictSelectionTest : ActionTest {
    private fun node(id: String, label: String = id, children: List<UiNode> = emptyList(), scroll: Boolean = false) = UiNode(
        id = UiNodeId("duplicate"), resourceId = id, role = UiRole.Button, label = label,
        className = "test.Node", bounds = Rect(0f, 0f, 100f, 100f),
        isClickable = true, isEnabled = true, isVisible = true, children = children,
        hints = mapOf("scrollable" to scroll.toString()),
    )

    private class Fixture(val trees: List<UiTree>, scope: CoroutineScope) {
        var captures = 0
        val dispatches = mutableListOf<String>()
        val ui = TaskUiScopeDefault(
            object : UiTreeInspector {
                override suspend fun getCurrentUiElements() = error("unused")
                override suspend fun getCurrentUiTree() = trees[(captures++).coerceAtMost(trees.lastIndex)]
                override suspend fun getCurrentWindowMetadata(): UiWindowMetadata? = null
                override suspend fun getCurrentUiHierarchyDump(): String? = null
            },
            object : UiTreeFilterer { override fun filterOnScreenOnly(uiTree: UiTree) = uiTree },
            proxy<UiTreeFormatter> { error("unused formatter") },
            proxy<UiTreeManager> { name ->
                dispatches += name
                if (name == "setText") TextSubmissionOutcome.NotRequested else true
            },
            scope,
        )
    }

    @Test fun `non-strict scroll search preserves initial container failure results`() = actionTest {
        for ((children, expectedReason) in listOf(
            emptyList<UiNode>() to TaskScrollTerminationReason.ContainerNotFound,
            listOf(node("scope")) to TaskScrollTerminationReason.ContainerNotScrollable,
        )) {
            val f = Fixture(listOf(UiTree(node("root", children = children))), backgroundScope)
            val result = f.ui.scrollLoop(NodeMatcher(resourceId = "target"), NodeMatcher(resourceId = "scope"))
            assertEquals(expectedReason, result.terminationReason)
            assertEquals(0, result.scrollsExecuted)
            assertNull(result.resolvedContainerId)
            assertTrue(f.dispatches.isEmpty())
        }
    }

    @Test fun `strict scroll search propagates initial container selection failures`() = actionTest {
        for (count in listOf(0, 2)) {
            val f = Fixture(listOf(UiTree(node("root", children = List(count) { node("scope", scroll = true) }))), backgroundScope)
            val error = assertFailsWith<StrictSelectionException> {
                f.ui.scrollLoop(NodeMatcher(resourceId = "target"), NodeMatcher(resourceId = "scope"), strict = true)
            }
            assertEquals(if (count == 0) "CONTAINER_NOT_FOUND" else "CONTAINER_AMBIGUOUS", error.code)
            assertEquals(count, error.candidateCount)
            assertTrue(f.dispatches.isEmpty())
        }
    }

    @Test fun `non-strict duplicate targets retain dispatch and teach strict mode`() = actionTest {
        for (strict in listOf(false, true)) {
            val f = Fixture(listOf(UiTree(node("root", children = List(2) { node("target") }))), backgroundScope)
            val warnings = SelectionWarnings()
            withContext(warnings) {
                if (strict) assertFailsWith<StrictSelectionException> {
                    f.ui.click(NodeMatcher(resourceId = "target"), strict = true)
                } else f.ui.click(NodeMatcher(resourceId = "target"))
            }
            if (strict) {
                assertTrue(warnings.stepData().isEmpty())
                assertTrue(f.dispatches.isEmpty())
            } else {
                assertEquals(listOf("triggerClick"), f.dispatches)
                assertTrue(warnings.stepData().getValue("selection_warning").contains("target: 2"))
                assertTrue(warnings.stepData().getValue("selection_warning").contains("Use --strict (params.strict=true)"))
            }
        }
    }

    @Test fun `unique selection query and intentional read-all omit discovery hints`() = actionTest {
        val f = Fixture(listOf(UiTree(node("root", children = List(2) { node("target") }))), backgroundScope)
        val warnings = SelectionWarnings()
        withContext(warnings) {
            f.ui.queryUi(NodeMatcher(resourceId = "target"))
            assertEquals(2, f.ui.getAllText(NodeMatcher(resourceId = "target")).size)
            f.ui.click(NodeMatcher(resourceId = "root"))
        }
        assertTrue(warnings.stepData().isEmpty())
    }

    @Test fun `duplicate containers teach strict mode even for read-all and warning count is bounded`() = actionTest {
        val f = Fixture(listOf(UiTree(node("root", children = List(2) { node("scope", children = listOf(node("target"))) }))), backgroundScope)
        val warnings = SelectionWarnings()
        withContext(warnings) {
            assertEquals(listOf("target"), f.ui.getAllTextWithinContainer(NodeMatcher(resourceId = "target"), NodeMatcher(resourceId = "scope")))
        }
        val warning = warnings.stepData().getValue("selection_warning")
        assertTrue(warning.contains("container: 2"))
        assertFalse(warning.contains("target:"))
        repeat(100) { warnings.record(2, container = true) }
        assertEquals(warning, warnings.stepData().getValue("selection_warning"))
    }

    @Test fun `immediate targets reject zero and two matches before dispatch and accept one`() = actionTest {
        for (count in 0..2) {
            val tree = UiTree(node("root", children = List(count) { node("target") }))
            for (operation in listOf<suspend (TaskUiScope) -> Unit>(
                { it.click(NodeMatcher(resourceId = "target"), strict = true) },
                { it.enterText(NodeMatcher(resourceId = "target"), "value", strict = true) },
                { it.getText(NodeMatcher(resourceId = "target"), strict = true) },
                { it.waitForNode(NodeMatcher(resourceId = "target"), strict = true) },
            )) {
                val f = Fixture(listOf(tree), backgroundScope)
                if (count == 1) operation(f.ui) else {
                    val error = assertFailsWith<StrictSelectionException> { operation(f.ui) }
                    assertEquals(if (count == 0) "NODE_NOT_FOUND" else "NODE_AMBIGUOUS", error.code)
                    assertEquals(count, error.candidateCount)
                    assertEquals(count, Json.parseToJsonElement(error.candidates).jsonObject.getValue("totalMatches").jsonPrimitive.int)
                    assertTrue(f.dispatches.isEmpty())
                }
            }
        }
    }

    @Test fun `container selection precedes child selection and excludes self and outsiders`() = actionTest {
        val container = node("scope", children = listOf(node("target"), node("target")))
        for (count in 0..2) {
            val f = Fixture(listOf(UiTree(node("root", children = List(count) { container } + node("target")))), backgroundScope)
            if (count == 1) {
                assertEquals(listOf("target", "target"), f.ui.getAllTextWithinContainer(NodeMatcher(resourceId = "target"), NodeMatcher(resourceId = "scope"), strict = true))
                assertEquals(emptyList(), f.ui.getAllTextWithinContainer(NodeMatcher(resourceId = "scope"), NodeMatcher(resourceId = "scope"), strict = true))
            } else {
                val e = assertFailsWith<StrictSelectionException> { f.ui.click(NodeMatcher(resourceId = "target"), strict = true, container = NodeMatcher(resourceId = "scope")) }
                assertEquals(if (count == 0) "CONTAINER_NOT_FOUND" else "CONTAINER_AMBIGUOUS", e.code)
                assertTrue(f.dispatches.isEmpty())
            }
        }
    }

    @Test fun `wait polls absent target and succeeds when unique target appears`() = actionTest {
        val f = Fixture(listOf(UiTree(node("root")), UiTree(node("root", children = listOf(node("target"))))), backgroundScope)
        assertEquals("target", f.ui.waitForNode(NodeMatcher(resourceId = "target"), retry = TaskRetryPresets.UiReadiness, strict = true).resourceId)
        assertEquals(2, f.captures)
        assertTrue(f.dispatches.isEmpty())
    }

    @Test fun `queries never authorize later dispatch and ambiguity is never retried`() = actionTest {
        val f = Fixture(listOf(UiTree(node("target")), UiTree(node("root", children = listOf(node("target"), node("target"))))), backgroundScope)
        f.ui.queryUi(NodeMatcher(resourceId = "target"), "on_screen", 100)
        assertFailsWith<StrictSelectionException> { f.ui.click(NodeMatcher(resourceId = "target"), retry = TaskRetryPresets.UiReadiness, strict = true) }
        assertEquals(2, f.captures)
        assertTrue(f.dispatches.isEmpty())
    }

    @Test fun `scroll search ignores outside target advances and finds target within unique container`() = actionTest {
        val before = UiTree(node("root", children = listOf(node("target"), node("scope", children = listOf(node("old")), scroll = true))))
        val after = UiTree(node("root", children = listOf(node("target"), node("scope", children = listOf(node("target")), scroll = true))))
        val f = Fixture(listOf(before, before, after), backgroundScope)
        val result = f.ui.scrollLoop(NodeMatcher(resourceId = "target"), NodeMatcher(resourceId = "scope"), settleDelay = 1.milliseconds, strict = true)
        assertEquals(TaskScrollTerminationReason.TargetFound, result.terminationReason)
        assertEquals(1, result.scrollsExecuted)
        assertEquals(listOf("swipeWithinVertical"), f.dispatches)
    }

    @Test fun `target becoming ambiguous at the next scroll dispatch prevents the gesture`() = actionTest {
        val before = UiTree(node("scope", children = listOf(node("old")), scroll = true))
        val after = UiTree(node("scope", children = List(2) { node("target") }, scroll = true))
        val f = Fixture(listOf(before, after), backgroundScope)
        assertFailsWith<StrictSelectionException> { f.ui.scrollLoop(NodeMatcher(resourceId = "target"), strict = true) }
        assertTrue(f.dispatches.isEmpty())
    }

    @Test fun `target appearing at scroll dispatch succeeds without a gesture`() = actionTest {
        val before = UiTree(node("scope", children = listOf(node("old")), scroll = true))
        val after = UiTree(node("scope", children = listOf(node("target")), scroll = true))
        val f = Fixture(listOf(before, after), backgroundScope)
        assertEquals(TaskScrollTerminationReason.TargetFound, f.ui.scrollLoop(NodeMatcher(resourceId = "target"), strict = true).terminationReason)
        assertTrue(f.dispatches.isEmpty())
    }

    @Test fun `scroll rejects ambiguous automatic or explicit containers before gestures`() = actionTest {
        val tree = UiTree(node("root", children = List(2) { node("scope", scroll = true) }))
        for (container in listOf(null, NodeMatcher(resourceId = "scope"))) {
            val f = Fixture(listOf(tree), backgroundScope)
            val e = assertFailsWith<StrictSelectionException> { f.ui.scrollOnce(container = container, strict = true) }
            assertEquals("CONTAINER_AMBIGUOUS", e.code)
            assertTrue(f.dispatches.isEmpty())
        }
    }

    @Test fun `scroll rechecks container after layout change and never issues another gesture`() = actionTest {
        val before = UiTree(node("root", children = listOf(node("scope", scroll = true))))
        val after = UiTree(node("root", children = List(2) { node("scope", scroll = true) }))
        val f = Fixture(listOf(before, before, after), backgroundScope)
        assertFailsWith<StrictSelectionException> { f.ui.scrollLoop(NodeMatcher(resourceId = "target"), strict = true, settleDelay = 1.milliseconds) }
        assertEquals(listOf("swipeWithinVertical"), f.dispatches)
    }

    @Test fun `scroll and click resolves fresh scope before clicking and rejects changed target count`() = actionTest {
        val before = UiTree(node("scope", children = listOf(node("target")), scroll = true))
        val after = UiTree(node("scope", children = List(2) { node("target") }, scroll = true))
        val f = Fixture(listOf(before, before, after), backgroundScope)
        assertFailsWith<StrictSelectionException> { f.ui.clickAfterScroll(NodeMatcher(resourceId = "target"), strict = true) }
        assertTrue(f.dispatches.isEmpty())
    }

    @Test fun `omitted strict retains first matching target and read all permits empty labels`() = actionTest {
        val f = Fixture(listOf(UiTree(node("root", children = listOf(node("target", ""), node("target", "second"))))), backgroundScope)
        f.ui.click(NodeMatcher(resourceId = "target"))
        assertEquals(listOf("triggerClick"), f.dispatches)
        assertEquals(listOf("second"), f.ui.getAllText(NodeMatcher(resourceId = "target"), strict = true))
        assertEquals(emptyList(), f.ui.getAllText(NodeMatcher(resourceId = "missing"), strict = true))
    }
}

@Suppress("UNCHECKED_CAST")
private inline fun <reified T> proxy(crossinline call: (String) -> Any?): T = Proxy.newProxyInstance(
    T::class.java.classLoader, arrayOf(T::class.java),
) { _, method, _ -> call(method.name) } as T
