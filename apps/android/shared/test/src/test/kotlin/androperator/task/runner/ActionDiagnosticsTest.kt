package androperator.task.runner

import action.math.geometry.Rect
import androperator.test.ActionTest
import androperator.test.actionTest
import androperator.uitree.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import java.lang.reflect.Proxy
import kotlin.test.*
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds

class ActionDiagnosticsTest : ActionTest {
    @Test fun `swipe dispatches once without hierarchy and never retries failure`() = actionTest {
        for (accepted in listOf(true, false)) {
            val fixture = Fixture(listOf(null), backgroundScope, accepted)
            val result = runCatching { fixture.ui.swipe(action.math.geometry.Point(10, 20), action.math.geometry.Point(100, 20), 300) }
            assertEquals(accepted, result.isSuccess)
            if (!accepted) assertEquals("GESTURE_FAILED", (result.exceptionOrNull() as UiActionFailure).code)
            assertEquals(1, fixture.dispatches)
            assertEquals(0, fixture.captures)
        }
    }

    private fun node(id: String, label: String = id, children: List<UiNode> = emptyList(), scroll: Boolean = false) = UiNode(
        id = UiNodeId(id), resourceId = id, role = UiRole.Button, label = label,
        className = "test.Node", bounds = Rect(0f, 0f, 100f, 100f),
        isClickable = true, isEnabled = true, isVisible = true, children = children,
        hints = mapOf("scrollable" to scroll.toString()),
    )
    private fun tree(children: List<UiNode> = listOf(node("row")), containers: Int = 1) =
        UiTree(node("root", children = List(containers) { node("list", children = children, scroll = true) }))

    private class Fixture(val trees: List<UiTree?>, scope: CoroutineScope, val accepted: Boolean = true) {
        var captures = 0
        var dispatches = 0
        val ui = TaskUiScopeDefault(
            object : UiTreeInspector {
                override suspend fun getCurrentUiElements() = error("unused")
                override suspend fun getCurrentUiTree() = trees[(captures++).coerceAtMost(trees.lastIndex)]
                override suspend fun getCurrentWindowMetadata(): UiWindowMetadata? = null
                override suspend fun getCurrentUiHierarchyDump(): String? = null
                override suspend fun getUnavailableHierarchyDiagnostics() = UiHierarchyDiagnostics(serviceAvailable = true, windowCount = 2)
            },
            object : UiTreeFilterer { override fun filterOnScreenOnly(uiTree: UiTree) = uiTree },
            proxy<UiTreeFormatter> { error("unused") },
            proxy<UiTreeManager> { dispatches++; accepted }, scope,
        )
    }

    @Test fun `scroll evidence distinguishes changed unchanged missing lost and ambiguous containers`() = actionTest {
        val cases = listOf(
            Triple(tree(), tree(listOf(node("row", "Changed row"))), TaskScrollOutcome.Moved),
            Triple(tree(), tree(), TaskScrollOutcome.NoMovement),
            Triple(tree(emptyList()), tree(emptyList()), TaskScrollOutcome.Unknown),
            Triple(tree(), tree(containers = 0), TaskScrollOutcome.ContainerLost),
            Triple(tree(), null, TaskScrollOutcome.ContainerLost),
            Triple(tree(), tree(containers = 2), TaskScrollOutcome.Unknown),
        )
        for ((before, after, expected) in cases) {
            val fixture = Fixture(listOf(before, after), backgroundScope)
            val result = fixture.ui.scrollOnce(container = NodeMatcher(resourceId = "list"), settleDelay = Duration.ZERO)
            assertEquals(expected, result.outcome)
            assertEquals(1, fixture.dispatches)
            val progress = Json.parseToJsonElement(result.progress!!).jsonObject
            assertEquals(expected in setOf(TaskScrollOutcome.Moved, TaskScrollOutcome.NoMovement), progress.getValue("comparable").jsonPrimitive.boolean)
            assertFalse(result.progress!!.contains("Changed row"))
            for (key in listOf("beforeSignature", "afterSignature")) {
                val value = progress.getValue(key)
                if (value != JsonNull) assertTrue(value.jsonPrimitive.content.matches(Regex("[0-9a-f]{64}")))
            }
        }
    }

    private fun nestedTree(scroll: Boolean, target: Boolean = false, outside: Boolean = false,
        reference: Any? = null, duplicateTarget: Boolean = false): UiTree {
        val targets = if (target) List(if (duplicateTarget) 2 else 1) { node("target") } else emptyList()
        val inner = node("inner", children = listOf(node("row")) + if (outside) emptyList() else targets, scroll = true)
        val outer = node("outer", children = listOf(inner), scroll = scroll).copy(accessibilityNodeInfo = reference)
        return UiTree(node("root", children = listOf(outer) + if (outside) targets else emptyList()))
    }

    @Test fun `revealed target survives eligibility loss for strict and legacy searches and clicks once`() = actionTest {
        for (strict in listOf(false, true)) {
            val reference = Any()
            val before = nestedTree(true, reference = reference)
            val after = nestedTree(false, target = true, reference = reference)
            val fixture = Fixture(listOf(before, before, after), backgroundScope)
            fixture.ui.clickAfterScroll(NodeMatcher(resourceId = "target"),
                container = if (strict) NodeMatcher(resourceId = "outer") else null,
                strict = strict, settleDelay = Duration.ZERO, scrollRetry = TaskRetry.None, clickRetry = TaskRetry.None)
            assertEquals(2, fixture.dispatches, "Exactly one scroll and one click")
        }
    }

    @Test fun `loop counts accepted gesture when its observation reveals target`() = actionTest {
        val before = nestedTree(true)
        val fixture = Fixture(listOf(before, before, nestedTree(false, target = true)), backgroundScope)
        val result = fixture.ui.scrollLoop(NodeMatcher(resourceId = "target"), settleDelay = Duration.ZERO)
        assertEquals(TaskScrollTerminationReason.TargetFound, result.terminationReason)
        assertEquals(1, result.scrollsExecuted)
        assertEquals("outer", result.scope!!.node.resourceId)
        assertEquals(1, fixture.dispatches)
    }

    @Test fun `absent or outside target after eligibility loss stops without switching to inner container`() = actionTest {
        for (strict in listOf(false, true)) for (outside in listOf(false, true)) {
            val before = nestedTree(true)
            val after = nestedTree(false, target = outside, outside = outside)
            val fixture = Fixture(listOf(before, before, after), backgroundScope)
            val result = fixture.ui.scrollLoop(NodeMatcher(resourceId = "target"),
                container = if (strict) NodeMatcher(resourceId = "outer") else null,
                strict = strict, settleDelay = Duration.ZERO)
            assertEquals(TaskScrollTerminationReason.ContainerNotScrollable, result.terminationReason)
            assertEquals(1, result.scrollsExecuted)
            assertEquals(1, fixture.dispatches)
        }
    }

    @Test fun `standalone scroll compares original scope even when it stops being scrollable`() = actionTest {
        val reference = Any()
        val fixture = Fixture(listOf(nestedTree(true, reference = reference),
            nestedTree(false, target = true, reference = reference)), backgroundScope)
        val result = fixture.ui.scrollOnce(settleDelay = Duration.ZERO)
        assertEquals(TaskScrollOutcome.Moved, result.outcome)
        assertEquals(true, Json.parseToJsonElement(result.progress!!).jsonObject["comparable"]!!.jsonPrimitive.boolean)
        assertEquals(1, fixture.dispatches)
    }

    @Test fun `platform replacement with identical resource bounds and path cannot reveal scoped target`() = actionTest {
        val before = nestedTree(true, reference = Any())
        val after = nestedTree(false, target = true, reference = Any())
        val fixture = Fixture(listOf(before, before, after), backgroundScope)
        val result = fixture.ui.scrollLoop(NodeMatcher(resourceId = "target"), settleDelay = Duration.ZERO)
        assertEquals(TaskScrollTerminationReason.ContainerLost, result.terminationReason)
        assertEquals(1, fixture.dispatches)
    }

    @Test fun `strict revealed target ambiguity does not trigger click or another gesture`() = actionTest {
        val before = nestedTree(true)
        val fixture = Fixture(listOf(before, before, nestedTree(false, target = true, duplicateTarget = true)), backgroundScope)
        val error = assertFailsWith<StrictSelectionException> {
            fixture.ui.clickAfterScroll(NodeMatcher(resourceId = "target"), NodeMatcher(resourceId = "outer"),
                strict = true, settleDelay = Duration.ZERO, scrollRetry = TaskRetry.None)
        }
        assertEquals("NODE_AMBIGUOUS", error.code)
        assertEquals(1, fixture.dispatches)
    }

    @Test fun `original scope must still exist at click time`() = actionTest {
        val reference = Any()
        val before = nestedTree(true, reference = reference)
        val after = nestedTree(false, target = true, reference = reference)
        val fixture = Fixture(listOf(before, before, after, after,
            nestedTree(false, target = true, reference = Any())), backgroundScope)
        val error = assertFailsWith<UiActionFailure> {
            fixture.ui.clickAfterScroll(NodeMatcher(resourceId = "target"), settleDelay = Duration.ZERO,
                scrollRetry = TaskRetry.None, clickRetry = TaskRetry.None)
        }
        assertEquals("CONTAINER_LOST", error.code)
        assertEquals(1, fixture.dispatches)
    }

    @Test fun `target can arrive during grace observation after eligibility loss`() = actionTest {
        val before = nestedTree(true)
        val fixture = Fixture(listOf(before, before, nestedTree(false), nestedTree(false),
            nestedTree(false, target = true)), backgroundScope)
        val result = fixture.ui.scrollLoop(NodeMatcher(resourceId = "target"), settleDelay = Duration.ZERO)
        assertEquals(TaskScrollTerminationReason.TargetFound, result.terminationReason)
        assertEquals(1, fixture.dispatches)
    }

    @Test fun `eligibility loss before dispatch is present not lost and dispatches nothing`() = actionTest {
        val fixture = Fixture(listOf(nestedTree(true), nestedTree(false)), backgroundScope)
        val result = fixture.ui.scrollLoop(NodeMatcher(resourceId = "target"), settleDelay = Duration.ZERO)
        assertEquals(TaskScrollTerminationReason.ContainerNotScrollable, result.terminationReason)
        assertEquals(0, fixture.dispatches)
    }

    @Test fun `target outside original scope never satisfies search while original remains scrollable`() = actionTest {
        val before = nestedTree(true)
        val fixture = Fixture(listOf(before, before, nestedTree(true, target = true, outside = true)), backgroundScope)
        val result = fixture.ui.scrollLoop(NodeMatcher(resourceId = "target"), maxScrolls = 2,
            noPositionChangeThreshold = 5, settleDelay = Duration.ZERO)
        assertEquals(TaskScrollTerminationReason.MaxScrollsReached, result.terminationReason)
        assertEquals(2, fixture.dispatches)
    }

    @Test fun `cancellation during post gesture settlement never dispatches another gesture`() = actionTest {
        val fixture = Fixture(listOf(nestedTree(true)), backgroundScope)
        assertNull(withTimeoutOrNull(20) {
            fixture.ui.scrollLoop(NodeMatcher(resourceId = "target"), settleDelay = 100.milliseconds)
        })
        assertEquals(1, fixture.dispatches)
    }

    @Test fun `gesture rejection is distinct and does not read a post gesture tree`() = actionTest {
        val fixture = Fixture(listOf(tree()), backgroundScope, accepted = false)
        val result = fixture.ui.scrollOnce(settleDelay = Duration.ZERO)
        assertEquals(TaskScrollOutcome.GestureFailed, result.outcome)
        assertEquals(1, fixture.captures)
    }

    @Test fun `strict ambiguous containers dispatch zero gestures`() = actionTest {
        val fixture = Fixture(listOf(tree(containers = 2)), backgroundScope)
        assertFailsWith<StrictSelectionException> { fixture.ui.scrollOnce(strict = true) }
        assertEquals(0, fixture.dispatches)
    }

    @Test fun `unknown and no movement count toward bounded loop threshold`() = actionTest {
        for (snapshot in listOf(tree(), tree(emptyList()))) {
            val fixture = Fixture(listOf(snapshot), backgroundScope)
            val result = fixture.ui.scrollLoop(target = null, maxScrolls = 10, noPositionChangeThreshold = 2, settleDelay = Duration.ZERO)
            assertEquals(TaskScrollTerminationReason.NoPositionChange, result.terminationReason)
            assertEquals(2, result.scrollsExecuted)
            assertEquals(2, fixture.dispatches)
        }
    }

    @Test fun `loop keeps max scroll and duration limits and terminates lost containers`() = actionTest {
        val capped = Fixture(listOf(tree()), backgroundScope)
        assertEquals(TaskScrollTerminationReason.MaxScrollsReached,
            capped.ui.scrollLoop(null, maxScrolls = 1, noPositionChangeThreshold = 5, settleDelay = Duration.ZERO).terminationReason)
        val timed = Fixture(listOf(tree()), backgroundScope)
        assertEquals(TaskScrollTerminationReason.MaxDurationReached,
            timed.ui.scrollLoop(null, maxDuration = Duration.ZERO).terminationReason)
        assertEquals(0, timed.dispatches)
        val lost = Fixture(listOf(tree(), tree(), null), backgroundScope)
        val result = lost.ui.scrollLoop(null, settleDelay = Duration.ZERO)
        assertEquals(TaskScrollTerminationReason.ContainerLost, result.terminationReason)
        assertEquals(1, result.scrollsExecuted)
    }

    @Test fun `expired node wait is typed while outer cancellation remains cancellation`() = actionTest {
        val fixture = Fixture(listOf(tree()), backgroundScope)
        val retry = TaskRetry(100, 10.milliseconds)
        val failure = assertFailsWith<UiActionFailure> {
            fixture.ui.waitForNode(NodeMatcher(resourceId = "missing"), retry, timeoutMs = 50)
        }
        assertEquals("WAIT_TIMEOUT", failure.code)
        assertNull(withTimeoutOrNull(20) {
            fixture.ui.waitForNode(NodeMatcher(resourceId = "missing"), retry, timeoutMs = 500)
        })
    }

    @Test fun `missing root diagnostics apply to clicks and no target is fabricated`() = actionTest {
        val fixture = Fixture(listOf(null), backgroundScope)
        val receipt = ActionReceipt()
        val failure = assertFailsWith<QueryHierarchyUnavailableException> {
            withContext(receipt) { fixture.ui.click(NodeMatcher(resourceId = "target"), retry = TaskRetry.None) }
        }
        assertEquals(true, failure.diagnostics.serviceAvailable)
        assertEquals(false, failure.diagnostics.rootAvailable)
        assertEquals(2, failure.diagnostics.windowCount)
        assertEquals("none", receipt.stepData()["dispatch_method"])
        assertEquals("false", receipt.stepData()["dispatch_accepted"])
        assertFalse(receipt.stepData().containsKey("target"))
    }

    @Test fun `receipt records ancestor dispatch and preserves matched target without claiming effect`() {
        val ancestorRef = Any()
        val matchedRef = Any()
        val matched = node("label").copy(accessibilityNodeInfo = matchedRef, accessibilityDataSensitive = true)
        val ancestor = node("wrapper", children = listOf(matched)).copy(accessibilityNodeInfo = ancestorRef)
        val receipt = ActionReceipt()
        receipt.selected(UiTree(ancestor), matched, 1)
        receipt.dispatch(ancestorRef, "accessibility_action", true)
        val data = receipt.stepData()
        assertEquals("wrapper", Json.parseToJsonElement(data.getValue("target")).jsonObject["resourceId"]!!.jsonPrimitive.content)
        val original = Json.parseToJsonElement(data.getValue("matched_target")).jsonObject
        assertEquals("label", original["resourceId"]!!.jsonPrimitive.content)
        assertEquals(true, original["accessibilityDataSensitive"]!!.jsonPrimitive.boolean)
        assertEquals("true", data["dispatch_accepted"])
        assertEquals("1", data["candidate_count"])
        assertTrue(data.getValue("elapsed_ms").toLong() >= 0)
        assertFalse(data.containsKey("postcondition"))
        receipt.dispatch(matchedRef, "coordinate_gesture", true)
        assertEquals("coordinate_gesture", receipt.stepData()["dispatch_method"])
        assertEquals(receipt.stepData()["target"], receipt.stepData()["matched_target"])
    }

    @Test fun `post dispatch failure is never replayed to obtain a receipt`() = actionTest {
        var dispatches = 0
        val reference = Any()
        val target = node("target").copy(accessibilityNodeInfo = reference)
        val manager = object : UiTreeManager by proxy<UiTreeManager>({ error("unused") }) {
            override suspend fun triggerClick(uiNode: UiNode, clickTypes: UiTreeClickTypes): Boolean {
                dispatches++
                kotlin.coroutines.coroutineContext[UiDispatchObservation]!!.record(reference, "accessibility_action", true)
                throw IllegalStateException("Observation failed after acceptance")
            }
        }
        val inspector = object : UiTreeInspector {
            override suspend fun getCurrentUiElements() = error("unused")
            override suspend fun getCurrentUiTree() = UiTree(target)
            override suspend fun getCurrentWindowMetadata(): UiWindowMetadata? = null
            override suspend fun getCurrentUiHierarchyDump(): String? = null
        }
        val ui = TaskUiScopeDefault(inspector,
            object : UiTreeFilterer { override fun filterOnScreenOnly(uiTree: UiTree) = uiTree },
            proxy<UiTreeFormatter> { error("unused") }, manager, backgroundScope)
        val receipt = ActionReceipt()
        assertFailsWith<IllegalStateException> {
            withContext(receipt + receipt.observation) {
                ui.click(NodeMatcher(resourceId = "target"), retry = TaskRetry(10))
            }
        }
        assertEquals(1, dispatches)
        assertEquals("true", receipt.stepData()["dispatch_accepted"])
    }

    private companion object {
        inline fun <reified T> proxy(crossinline invoke: () -> Any?): T =
            Proxy.newProxyInstance(T::class.java.classLoader, arrayOf(T::class.java)) { _, _, _ -> invoke() } as T
    }
}
