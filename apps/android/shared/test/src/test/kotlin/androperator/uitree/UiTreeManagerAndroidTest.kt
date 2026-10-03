package androperator.uitree

import action.math.geometry.Rect
import android.view.accessibility.AccessibilityNodeInfo
import androperator.accessibilityservice.AccessibilityServiceManager
import androperator.accessibilityservice.NoOpTextInputConnectionSource
import androperator.accessibilityservice.TextInputConnectionSource
import androperator.accessibilityservice.TextInputEditorInfo
import androperator.accessibilityservice.TextInputSession
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.runner.RunWith
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.robolectric.annotation.Config
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowAccessibilityNodeInfo

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class UiTreeManagerAndroidTest {
    class ReceiptService : android.accessibilityservice.AccessibilityService() {
        override fun onAccessibilityEvent(event: android.view.accessibility.AccessibilityEvent?) {}
        override fun onInterrupt() {}
    }

    @Test
    @org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
    fun `swipe dispatches exact path and duration and reports callback outcome`() = runTest {
        for (completed in listOf(true, false)) {
            val service = org.robolectric.Robolectric.buildService(ReceiptService::class.java).create().get()
            val services = androperator.accessibilityservice.AccessibilityServiceManagerAndroid().apply {
                setCurrentAccessibilityService(service, true)
            }
            val shadow = Shadow.extract<org.robolectric.shadows.ShadowAccessibilityService>(service)
            shadow.setCanDispatchGestures(true)
            val observations = mutableListOf<Triple<Any?, String, Boolean>>()
            val observer = UiDispatchObservation { target, method, accepted -> observations += Triple(target, method, accepted) }
            val action = async(observer) { UiTreeManagerAndroid(services).swipeAt(10, 20, 100, 200, 321) }
            testScheduler.runCurrent()
            assertEquals(Triple(null, "coordinate_gesture", true), observations.last())
            assertFalse(action.isCompleted)
            val dispatched = shadow.gesturesDispatched.single()
            val stroke = dispatched.description().getStroke(0)
            assertEquals(321L, stroke.duration)
            val path = android.graphics.PathMeasure(stroke.path, false)
            val position = FloatArray(2)
            path.getPosTan(0f, position, null)
            assertEquals(10f, position[0])
            assertEquals(20f, position[1])
            path.getPosTan(path.length, position, null)
            assertEquals(100f, position[0])
            assertEquals(200f, position[1])
            if (completed) dispatched.callback().onCompleted(dispatched.description())
            else dispatched.callback().onCancelled(dispatched.description())
            assertEquals(completed, action.await())
            assertEquals(1, shadow.gesturesDispatched.size)
        }
    }

    @Test
    fun `swipe rejects out of display coordinates and invalid durations without dispatch`() = runTest {
        val service = org.robolectric.Robolectric.buildService(ReceiptService::class.java).create().get()
        val services = androperator.accessibilityservice.AccessibilityServiceManagerAndroid().apply {
            setCurrentAccessibilityService(service, true)
        }
        val shadow = Shadow.extract<org.robolectric.shadows.ShadowAccessibilityService>(service)
        shadow.setCanDispatchGestures(true)
        val manager = UiTreeManagerAndroid(services)
        assertFalse(manager.swipeAt(-1, 20, 100, 200, 300))
        assertFalse(manager.swipeAt(10, 20, Int.MAX_VALUE, 200, 300))
        assertFalse(manager.swipeAt(10, 20, 10, 20, 300))
        assertFalse(manager.swipeAt(10, 20, 100, 200, 0))
        assertFalse(manager.swipeAt(10, 20, 100, 200, 10001))
        assertTrue(shadow.gesturesDispatched.isEmpty())
        shadow.setCanDispatchGestures(false)
        assertFalse(manager.swipeAt(10, 20, 100, 200, 300))
    }

    @Test
    fun `swipe callback after coroutine cancellation is harmless`() = runTest {
        val service = org.robolectric.Robolectric.buildService(ReceiptService::class.java).create().get()
        val services = androperator.accessibilityservice.AccessibilityServiceManagerAndroid().apply {
            setCurrentAccessibilityService(service, true)
        }
        val shadow = Shadow.extract<org.robolectric.shadows.ShadowAccessibilityService>(service)
        shadow.setCanDispatchGestures(true)
        val action = async { UiTreeManagerAndroid(services).swipeAt(10, 20, 100, 200, 300) }
        testScheduler.runCurrent()
        val dispatched = shadow.gesturesDispatched.single()
        action.cancel()
        action.join()
        dispatched.callback().onCompleted(dispatched.description())
        assertTrue(action.isCancelled)
        assertEquals(1, shadow.gesturesDispatched.size)
    }

    @Test
    fun `click receipt names accepted ancestor and never asserts screen change`() = runTest {
        val service = org.robolectric.Robolectric.buildService(ReceiptService::class.java).create().get()
        val services = androperator.accessibilityservice.AccessibilityServiceManagerAndroid().apply {
            setCurrentAccessibilityService(service, true)
        }
        val parent = AccessibilityNodeInfo.obtain().apply { isClickable = true; isEnabled = true }
        val child = AccessibilityNodeInfo.obtain()
        Shadow.extract<ShadowAccessibilityNodeInfo>(parent).addChild(child)
        Shadow.extract<ShadowAccessibilityNodeInfo>(parent).setOnPerformActionListener { _, _ -> true }
        val observations = mutableListOf<Triple<Any?, String, Boolean>>()
        val observer = UiDispatchObservation { target, method, accepted -> observations += Triple(target, method, accepted) }
        val accepted = kotlinx.coroutines.withContext(observer) {
            UiTreeManagerAndroid(services).triggerClick(uiNode(child), UiTreeClickTypes.Default)
        }
        assertTrue(accepted)
        assertEquals(Triple(parent, "accessibility_action", true), observations.last())
    }

    @Test
    fun `gesture fallback records acceptance before completion or cancellation`() = runTest {
        val service = org.robolectric.Robolectric.buildService(ReceiptService::class.java).create().get()
        val services = androperator.accessibilityservice.AccessibilityServiceManagerAndroid().apply {
            setCurrentAccessibilityService(service, true)
        }
        val shadow = Shadow.extract<org.robolectric.shadows.ShadowAccessibilityService>(service)
        shadow.setCanDispatchGestures(true)
        val child = AccessibilityNodeInfo.obtain().apply {
            setBoundsInScreen(android.graphics.Rect(0, 0, 100, 100))
        }
        val observations = mutableListOf<Triple<Any?, String, Boolean>>()
        val observer = UiDispatchObservation { target, method, accepted -> observations += Triple(target, method, accepted) }
        val action = async(observer) {
            UiTreeManagerAndroid(services).triggerClick(uiNode(child), UiTreeClickTypes.Default)
        }
        testScheduler.runCurrent()
        assertEquals(Triple(child, "coordinate_gesture", true), observations.last())
        val dispatched = shadow.gesturesDispatched.single()
        dispatched.callback().onCompleted(dispatched.description())
        assertTrue(action.await())
        assertEquals(1, shadow.gesturesDispatched.size)
    }

    @Test
    fun `setText clear true performs empty set then text set`() =
        runTest {
            val manager = createManager()
            val nodeInfo = editableNode()
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = false, clear = true)

            assertEquals(TextSubmissionOutcome.NotRequested, result)
            assertEquals(listOf("", "hello"), performedSetTextValues(nodeInfo))
        }

    @Test
    fun `setText clear failure stops before text set`() =
        runTest {
            val manager = createManager()
            val nodeInfo = editableNode()
            val shadow = Shadow.extract<ShadowAccessibilityNodeInfo>(nodeInfo)
            shadow.setOnPerformActionListener { action, arguments ->
                if (action != AccessibilityNodeInfo.ACTION_SET_TEXT) {
                    true
                } else {
                    arguments?.getCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE) != ""
                }
            }
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = false, clear = true)

            assertEquals(null, result)
            assertEquals(listOf(""), performedSetTextValues(nodeInfo))
        }

    @Test
    fun `setText clear failure can fall through to api33 input connection`() =
        runTest {
            val session = FakeTextInputSession(initialText = "existing")
            val manager = createManager(textInputConnectionSource = FakeTextInputConnectionSource(session))
            val nodeInfo = editableNode()
            val shadow = Shadow.extract<ShadowAccessibilityNodeInfo>(nodeInfo)
            shadow.setOnPerformActionListener { action, arguments ->
                if (action != AccessibilityNodeInfo.ACTION_SET_TEXT) {
                    true
                } else {
                    arguments?.getCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE) != ""
                }
            }
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = false, clear = true)

            assertEquals(TextSubmissionOutcome.NotRequested, result)
            assertEquals(listOf(""), performedSetTextValues(nodeInfo))
            assertEquals("hello", session.text)
            assertEquals(
                listOf(
                    "setSelection(2147483647,2147483647)",
                    "deleteSurroundingText(2147483647,0)",
                    "commitText(hello,1)",
                ),
                session.operations,
            )
        }

    @Test
    fun `setText clear false performs one text set`() =
        runTest {
            val manager = createManager()
            val nodeInfo =
                editableNode().apply {
                    text = "existing"
                }
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = false, clear = false)

            assertEquals(TextSubmissionOutcome.NotRequested, result)
            assertEquals(listOf("hello"), performedSetTextValues(nodeInfo))
        }

    @Test
    fun `setText submit true prefers ime enter action when available`() =
        runTest {
            val manager = createManager()
            val nodeInfo = editableNode(includeImeEnterAction = true)
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = true, clear = false)

            assertEquals(TextSubmissionOutcome.ImeEditorAction, result)
            assertEquals(listOf("hello"), performedSetTextValues(nodeInfo))
            assertTrue(performedActionIds(nodeInfo).contains(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id))
            assertFalse(performedActionIds(nodeInfo).contains(AccessibilityNodeInfo.ACTION_CLICK))
        }

    @Test
    fun `setText submit true falls back to click when ime enter action is unavailable`() =
        runTest {
            val manager = createManager()
            val nodeInfo = editableNode()
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = true, clear = false)

            assertEquals(TextSubmissionOutcome.ClickFallback, result)
            assertEquals(listOf("hello"), performedSetTextValues(nodeInfo))
            assertFalse(performedActionIds(nodeInfo).contains(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id))
            assertTrue(performedActionIds(nodeInfo).contains(AccessibilityNodeInfo.ACTION_CLICK))
        }

    @Test
    fun `setText submit fallback stays best effort when click cannot run`() =
        runTest {
            val manager = createManager()
            val nodeInfo = editableNode()
            val shadow = Shadow.extract<ShadowAccessibilityNodeInfo>(nodeInfo)
            shadow.setOnPerformActionListener { action, arguments ->
                when (action) {
                    AccessibilityNodeInfo.ACTION_SET_TEXT -> true
                    AccessibilityNodeInfo.ACTION_CLICK -> false
                    else -> true
                }
            }
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = true, clear = false)

            assertEquals(TextSubmissionOutcome.Unavailable, result)
            assertEquals(listOf("hello"), performedSetTextValues(nodeInfo))
            assertTrue(performedActionIds(nodeInfo).contains(AccessibilityNodeInfo.ACTION_CLICK))
        }

    @Test
    fun `setText fails when no text-entry strategy succeeds`() =
        runTest {
            val manager = createManager()
            val nodeInfo = editableNode()
            val shadow = Shadow.extract<ShadowAccessibilityNodeInfo>(nodeInfo)
            shadow.setOnPerformActionListener { action, arguments ->
                when (action) {
                    AccessibilityNodeInfo.ACTION_SET_TEXT -> false
                    else -> true
                }
            }
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = false, clear = false)

            assertEquals(null, result)
            assertEquals(listOf("hello"), performedSetTextValues(nodeInfo))
        }

    @Test
    fun `setText uses api33 input connection when legacy set text is unavailable`() =
        runTest {
            val session = FakeTextInputSession(initialText = "existing")
            val manager = createManager(textInputConnectionSource = FakeTextInputConnectionSource(session))
            val nodeInfo = editableNode(includeSetTextAction = false)
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = false, clear = false)

            assertEquals(TextSubmissionOutcome.NotRequested, result)
            assertEquals("hello", session.text)
            assertEquals(
                listOf(
                    "setSelection(2147483647,2147483647)",
                    "deleteSurroundingText(2147483647,0)",
                    "commitText(hello,1)",
                ),
                session.operations,
            )
        }

    @Test
    fun `setText api33 path uses delete fallback even when surrounding text is present`() =
        runTest {
            val session =
                FakeTextInputSession(
                    initialText = "existing",
                )
            val manager = createManager(textInputConnectionSource = FakeTextInputConnectionSource(session))
            val nodeInfo = editableNode(includeSetTextAction = false)
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = false, clear = false)

            assertEquals(TextSubmissionOutcome.NotRequested, result)
            assertEquals("hello", session.text)
            assertEquals(
                listOf(
                    "setSelection(2147483647,2147483647)",
                    "deleteSurroundingText(2147483647,0)",
                    "commitText(hello,1)",
                ),
                session.operations,
            )
        }

    @Test
    fun `setText api33 path uses editor action for submit`() =
        runTest {
            val session =
                FakeTextInputSession(
                    initialText = "existing",
                    editorInfo = FakeTextInputSession.editorInfo(actionId = 42),
                )
            val manager = createManager(textInputConnectionSource = FakeTextInputConnectionSource(session))
            val nodeInfo = editableNode(includeSetTextAction = false)
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = true, clear = false)

            assertEquals(TextSubmissionOutcome.ImeEditorAction, result)
            assertEquals("hello", session.text)
            assertTrue(session.operations.contains("performEditorAction(42)"))
            assertFalse(performedActionIds(nodeInfo).contains(AccessibilityNodeInfo.ACTION_CLICK))
        }

    @Test
    fun `setText retains accepted text when editor action is rejected`() = runTest {
        val session = FakeTextInputSession(
            initialText = "existing",
            editorInfo = FakeTextInputSession.editorInfo(actionId = 42),
            allowEditorAction = false,
        )
        val manager = createManager(textInputConnectionSource = FakeTextInputConnectionSource(session))
        val result = manager.setText(uiNode(editableNode(includeSetTextAction = false)), "hello", submit = true)
        assertEquals(TextSubmissionOutcome.Unavailable, result)
        assertEquals("hello", session.text)
        assertEquals(1, session.operations.count { it == "commitText(hello,1)" })
        assertEquals(1, session.operations.count { it == "performEditorAction(42)" })
    }

    @Test
    fun `setText api33 path returns null when session is missing and legacy route is unavailable`() =
        runTest {
            val manager = createManager(textInputConnectionSource = NoOpTextInputConnectionSource)
            val nodeInfo = editableNode(includeSetTextAction = false)
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = false, clear = false)

            assertEquals(null, result)
        }

    @Test
    fun `setText api33 path returns null when session is finished and legacy route is unavailable`() =
        runTest {
            val session = FakeTextInputSession(initialText = "existing", isActive = false)
            val manager = createManager(textInputConnectionSource = FakeTextInputConnectionSource(session))
            val nodeInfo = editableNode(includeSetTextAction = false)
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = false, clear = false)

            assertEquals(null, result)
        }

    @Test
    fun `setText api33 path keeps text entry successful when editor info is missing`() =
        runTest {
            val session = FakeTextInputSession(initialText = "existing", editorInfo = null)
            val manager = createManager(textInputConnectionSource = FakeTextInputConnectionSource(session))
            val nodeInfo = editableNode(includeSetTextAction = false)
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = true, clear = false)

            assertEquals(TextSubmissionOutcome.Unavailable, result)
            assertEquals("hello", session.text)
            assertEquals(
                listOf(
                    "setSelection(2147483647,2147483647)",
                    "deleteSurroundingText(2147483647,0)",
                    "commitText(hello,1)",
                ),
                session.operations,
            )
        }

    @Test
    fun `setText api33 path waits for retry after focus handoff`() =
        runTest {
            val session = FakeTextInputSession(initialText = "existing")
            val manager = createManager(textInputConnectionSource = FakeTextInputConnectionSource(session))
            val nodeInfo =
                editableNode(includeSetTextAction = false).apply {
                    isFocused = false
                }
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = false, clear = false)

            assertEquals(null, result)
            assertEquals("existing", session.text)
            assertEquals(emptyList(), session.operations)
            assertTrue(performedActionIds(nodeInfo).contains(AccessibilityNodeInfo.ACTION_FOCUS))
            assertTrue(performedActionIds(nodeInfo).contains(AccessibilityNodeInfo.ACTION_CLICK))
        }

    @Test
    fun `setText api33 path keeps replace semantics when clear is true`() =
        runTest {
            val session =
                FakeTextInputSession(
                    initialText = "existing",
                )
            val manager = createManager(textInputConnectionSource = FakeTextInputConnectionSource(session))
            val nodeInfo = editableNode(includeSetTextAction = false)
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = false, clear = true)

            assertEquals(TextSubmissionOutcome.NotRequested, result)
            assertEquals("hello", session.text)
            assertEquals(
                listOf(
                    "setSelection(2147483647,2147483647)",
                    "deleteSurroundingText(2147483647,0)",
                    "commitText(hello,1)",
                ),
                session.operations,
            )
        }

    @Test
    fun `setText api33 path returns false when delete fallback fails`() =
        runTest {
            val session = FakeTextInputSession(initialText = "existing", allowDeleteSurroundingText = false)
            val manager = createManager(textInputConnectionSource = FakeTextInputConnectionSource(session))
            val nodeInfo = editableNode(includeSetTextAction = false)
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = false, clear = false)

            assertEquals(null, result)
            assertEquals("existing", session.text)
            assertEquals(
                listOf(
                    "setSelection(2147483647,2147483647)",
                    "deleteSurroundingText(2147483647,0)",
                ),
                session.operations,
            )
        }

    @Test
    fun `setText api33 path returns false when commit fails after delete`() =
        runTest {
            val session =
                FakeTextInputSession(
                    initialText = "existing",
                    allowCommitText = false,
                )
            val manager = createManager(textInputConnectionSource = FakeTextInputConnectionSource(session))
            val nodeInfo = editableNode(includeSetTextAction = false)
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = false, clear = false)

            assertEquals(null, result)
            assertEquals("", session.text)
            assertEquals(
                listOf(
                    "setSelection(2147483647,2147483647)",
                    "deleteSurroundingText(2147483647,0)",
                    "commitText(hello,1)",
                ),
                session.operations,
            )
        }

    @Test
    @Config(sdk = [32])
    fun `setText skips api33 path on lower api levels`() =
        runTest {
            val session = FakeTextInputSession(initialText = "existing")
            val manager = createManager(textInputConnectionSource = FakeTextInputConnectionSource(session))
            val nodeInfo = editableNode(includeSetTextAction = false)
            val uiNode = uiNode(nodeInfo)

            val result = manager.setText(uiNode = uiNode, text = "hello", submit = false, clear = false)

            assertEquals(null, result)
            assertEquals(emptyList(), session.operations)
        }

    @Test
    fun `enter text retries focus handoff through the real manager without replaying text`() = runTest {
        val session = FakeTextInputSession(initialText = "existing")
        val manager = createManager(FakeTextInputConnectionSource(session))
        val nodeInfo = editableNode(includeSetTextAction = false).apply { isFocused = false }
        var captures = 0
        val inspector = object : UiTreeInspector {
            override suspend fun getCurrentUiElements() = error("unused")
            override suspend fun getCurrentUiTree(): UiTree {
                // Model the asynchronous focus handoff completing before the retry capture.
                if (++captures > 1) nodeInfo.isFocused = true
                return UiTree(uiNode(nodeInfo))
            }
            override suspend fun getCurrentWindowMetadata(): UiWindowMetadata? = null
            override suspend fun getCurrentUiHierarchyDump(): String? = null
        }
        val formatter = java.lang.reflect.Proxy.newProxyInstance(
            UiTreeFormatter::class.java.classLoader, arrayOf(UiTreeFormatter::class.java),
        ) { _, _, _ -> error("unused") } as UiTreeFormatter
        val ui = androperator.task.runner.TaskUiScopeDefault(inspector,
            object : UiTreeFilterer { override fun filterOnScreenOnly(uiTree: UiTree) = uiTree },
            formatter, manager, backgroundScope)
        val receipt = androperator.task.runner.ActionReceipt()
        kotlinx.coroutines.withContext(receipt + receipt.observation) {
            ui.enterText(androperator.task.runner.NodeMatcher(textEquals = "Field"), "hello",
                retry = androperator.task.runner.TaskRetry(3))
        }
        assertEquals(2, captures)
        assertEquals("hello", session.text)
        assertEquals(1, session.operations.count { it.startsWith("commitText(") })
        assertTrue(receipt.observation.retryBlocked)
        assertEquals("true", receipt.stepData()["dispatch_accepted"])
    }

    @Test
    fun `uncertain focus preparation blocks retries in both text entry strategies`() = runTest {
        for (failingAction in listOf(AccessibilityNodeInfo.ACTION_FOCUS, AccessibilityNodeInfo.ACTION_CLICK)) {
            // The legacy strategy prepares focus first; the input-connection fallback prepares it second.
            for (failingPreparation in 1..2) {
                val session = FakeTextInputSession(initialText = "existing")
                val manager = createManager(FakeTextInputConnectionSource(session))
                val nodeInfo = editableNode(includeSetTextAction = false).apply { isFocused = false }
                val failure = IllegalStateException("Focus preparation dispatched but result unavailable")
                var actionAttempts = 0
                var captures = 0
                Shadow.extract<ShadowAccessibilityNodeInfo>(nodeInfo).setOnPerformActionListener { action, _ ->
                    if (action == failingAction && ++actionAttempts == failingPreparation) {
                        throw failure
                    }
                    action != AccessibilityNodeInfo.ACTION_SET_TEXT
                }
                val inspector = object : UiTreeInspector {
                    override suspend fun getCurrentUiElements() = error("unused")
                    override suspend fun getCurrentUiTree(): UiTree {
                        captures++
                        return UiTree(uiNode(nodeInfo))
                    }
                    override suspend fun getCurrentWindowMetadata(): UiWindowMetadata? = null
                    override suspend fun getCurrentUiHierarchyDump(): String? = null
                }
                val formatter = java.lang.reflect.Proxy.newProxyInstance(
                    UiTreeFormatter::class.java.classLoader, arrayOf(UiTreeFormatter::class.java),
                ) { _, _, _ -> error("unused") } as UiTreeFormatter
                val ui = androperator.task.runner.TaskUiScopeDefault(
                    inspector,
                    object : UiTreeFilterer { override fun filterOnScreenOnly(uiTree: UiTree) = uiTree },
                    formatter, manager, backgroundScope,
                )
                val receipt = androperator.task.runner.ActionReceipt()
                val thrown = kotlin.test.assertFailsWith<IllegalStateException> {
                    kotlinx.coroutines.withContext(receipt + receipt.observation) {
                        ui.enterText(
                            androperator.task.runner.NodeMatcher(textEquals = "Field"), "hello",
                            retry = androperator.task.runner.TaskRetry(3),
                        )
                    }
                }
                val scenario = "action=$failingAction preparation=$failingPreparation"
                assertEquals(failure.message, thrown.message, scenario)
                assertEquals(1, captures, scenario)
                assertEquals(failingPreparation, actionAttempts, scenario)
                assertTrue(receipt.observation.retryBlocked, scenario)
                assertEquals("false", receipt.stepData()["dispatch_accepted"], scenario)
                assertEquals("existing", session.text, scenario)
                assertTrue(session.operations.isEmpty(), scenario)
            }
        }
    }

    @Test
    fun `successful clear blocks retry even when subsequent text replacement is rejected`() = runTest {
        val manager = createManager()
        val nodeInfo = editableNode()
        Shadow.extract<ShadowAccessibilityNodeInfo>(nodeInfo).setOnPerformActionListener { action, args ->
            action == AccessibilityNodeInfo.ACTION_SET_TEXT &&
                args?.getCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE) == ""
        }
        val observer = UiDispatchObservation { _, _, _ -> }
        val success = kotlinx.coroutines.withContext(observer) {
            manager.setText(uiNode(nodeInfo), "hello", submit = false, clear = true)
        }
        assertEquals(null, success)
        assertTrue(observer.retryBlocked)
        assertEquals(listOf("", "hello"), performedSetTextValues(nodeInfo))
    }

    private fun editableNode(
        includeImeEnterAction: Boolean = false,
        includeSetTextAction: Boolean = true,
    ): AccessibilityNodeInfo =
        AccessibilityNodeInfo.obtain().apply {
            if (includeSetTextAction) {
                addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_SET_TEXT)
            }
            if (includeImeEnterAction) {
                addAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER)
            }
            isEditable = true
            isFocused = true
            if (!includeSetTextAction) {
                val shadow = Shadow.extract<ShadowAccessibilityNodeInfo>(this)
                shadow.setOnPerformActionListener { action, arguments ->
                    when (action) {
                        AccessibilityNodeInfo.ACTION_SET_TEXT -> false
                        else -> true
                    }
                }
            }
        }

    private fun uiNode(nodeInfo: AccessibilityNodeInfo): UiNode =
        UiNode(
            id = UiNodeId("0:0"),
            role = UiRole.TextField,
            label = "Field",
            className = "android.widget.EditText",
            bounds = Rect.Zero,
            isClickable = true,
            isEnabled = true,
            isVisible = true,
            accessibilityNodeInfo = nodeInfo,
        )

    private fun performedSetTextValues(nodeInfo: AccessibilityNodeInfo): List<String> {
        val shadow = Shadow.extract<ShadowAccessibilityNodeInfo>(nodeInfo)
        return shadow.getPerformedActionsWithArgs()
            .filter { it.first == AccessibilityNodeInfo.ACTION_SET_TEXT }
            .map { pair ->
                pair.second
                    ?.getCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE)
                    ?.toString()
                    ?: ""
            }
    }

    private fun performedActionIds(nodeInfo: AccessibilityNodeInfo): List<Int> {
        val shadow = Shadow.extract<ShadowAccessibilityNodeInfo>(nodeInfo)
        return shadow.getPerformedActionsWithArgs().map { it.first }
    }

    private fun createManager(
        textInputConnectionSource: TextInputConnectionSource = NoOpTextInputConnectionSource,
    ): UiTreeManagerAndroid =
        UiTreeManagerAndroid(
            accessibilityServiceManager =
                AccessibilityServiceManagerStub(
                    textInputConnectionSource = textInputConnectionSource,
                ),
        )

    private class AccessibilityServiceManagerStub(
        private val textInputConnectionSource: TextInputConnectionSource = NoOpTextInputConnectionSource,
    ) :
        AccessibilityServiceManager,
        TextInputConnectionSource by textInputConnectionSource {
        override val isRunning: Flow<Boolean> = flowOf(false)
    }

    private class FakeTextInputConnectionSource(
        private val session: TextInputSession?,
    ) : TextInputConnectionSource {
        override fun currentSession(): TextInputSession? = session
    }

    private class FakeTextInputSession(
        initialText: String,
        override val isActive: Boolean = true,
        override val editorInfo: TextInputEditorInfo? = editorInfo(),
        private val allowDeleteSurroundingText: Boolean = true,
        private val allowCommitText: Boolean = true,
        private val allowEditorAction: Boolean = true,
    ) : TextInputSession {
        var text: String = initialText
            private set
        val operations = mutableListOf<String>()
        private var selectionStart: Int = initialText.length
        private var selectionEnd: Int = initialText.length

        override fun setSelection(
            start: Int,
            end: Int,
        ): Boolean {
            operations += "setSelection($start,$end)"
            if (!isActive) {
                return false
            }
            val resolvedStart =
                if (start == Int.MAX_VALUE) {
                    text.length
                } else {
                    start.coerceIn(0, text.length)
                }
            val resolvedEnd =
                if (end == Int.MAX_VALUE) {
                    text.length
                } else {
                    end.coerceIn(0, text.length)
                }
            selectionStart = resolvedStart
            selectionEnd = resolvedEnd
            return true
        }

        override fun deleteSurroundingText(
            beforeLength: Int,
            afterLength: Int,
        ): Boolean {
            operations += "deleteSurroundingText($beforeLength,$afterLength)"
            if (!isActive || !allowDeleteSurroundingText) {
                return false
            }
            val cursor = maxOf(selectionStart, selectionEnd)
            val deleteStart = (cursor - beforeLength).coerceAtLeast(0)
            val deleteEnd = (cursor + afterLength).coerceAtMost(text.length)
            text = text.removeRange(deleteStart, deleteEnd)
            selectionStart = deleteStart
            selectionEnd = deleteStart
            return true
        }

        override fun commitText(
            text: CharSequence,
            newCursorPosition: Int,
        ): Boolean {
            operations += "commitText($text,$newCursorPosition)"
            if (!isActive || !allowCommitText) {
                return false
            }
            val start = minOf(selectionStart, selectionEnd)
            val end = maxOf(selectionStart, selectionEnd)
            this.text = this.text.replaceRange(start, end, text.toString())
            val cursor = start + text.length
            selectionStart = cursor
            selectionEnd = cursor
            return true
        }

        override fun performEditorAction(editorAction: Int): Boolean {
            operations += "performEditorAction($editorAction)"
            return isActive && allowEditorAction
        }

        companion object {
            fun editorInfo(
                actionId: Int = 0,
                imeOptions: Int = 0,
            ): TextInputEditorInfo =
                TextInputEditorInfo(
                    actionId = actionId,
                    imeOptions = imeOptions,
                )
        }
    }
}
