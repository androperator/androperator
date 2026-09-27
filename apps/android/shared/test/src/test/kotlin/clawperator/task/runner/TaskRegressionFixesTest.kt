package clawperator.task.runner

import clawperator.uitree.TextSubmissionOutcome
import action.math.geometry.Rect
import clawperator.app.close.AppCloseManager
import clawperator.apps.AppsRepository
import clawperator.test.ActionTest
import clawperator.test.actionTest
import clawperator.trigger.TriggerManager
import clawperator.uitree.UiNode
import clawperator.uitree.UiNodeId
import clawperator.uitree.UiRole
import clawperator.uitree.UiTree
import clawperator.uitree.UiTreeFilterer
import clawperator.uitree.UiTreeFormatter
import clawperator.uitree.UiTreeInspector
import clawperator.uitree.UiTreeManager
import clawperator.uitree.UiWindowMetadata
import clawperator.urlnavigator.UrlNavigator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.withContext
import kotlinx.coroutines.test.advanceUntilIdle
import timber.log.Timber
import java.lang.reflect.Proxy
import kotlin.coroutines.EmptyCoroutineContext
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class TaskRegressionFixesTest : ActionTest {
    private data class RecordedSetTextCall(
        val text: String,
        val clear: Boolean,
        val submit: Boolean,
    )

    @Test
    fun `wait_for_navigation times out when target package never changes`() =
        actionTest {
            val taskScope =
                TaskScopeDefault(
                    appsRepository = unusedProxy(),
                    triggerManager = unusedProxy(),
                    appCloseManager = unusedProxy(),
                    uiTreeInspector =
                        SequenceUiTreeInspector(
                            listOf(
                                UiWindowMetadata(foregroundPackage = "com.android.settings"),
                                UiWindowMetadata(foregroundPackage = "com.android.settings"),
                                UiWindowMetadata(foregroundPackage = "com.android.settings"),
                            ),
                        ),
                    uiTreeFilterer = IdentityUiTreeFilterer,
                    uiTreeFormatter = unusedProxy(),
                    taskUiScope = unusedProxy(),
                    urlNavigator = unusedProxy(),
                    coroutineScopeIo = backgroundScope,
                )

            val result = async {
                taskScope.waitForNavigation(
                    expectedPackage = "com.android.settings",
                    expectedNode = null,
                    timeoutMs = 500,
                )
            }

            advanceUntilIdle()

            assertFalse(result.await().success)
        }

    @Test
    fun `wait_for_navigation succeeds after package changes away and back`() =
        actionTest {
            val taskScope =
                TaskScopeDefault(
                    appsRepository = unusedProxy(),
                    triggerManager = unusedProxy(),
                    appCloseManager = unusedProxy(),
                    uiTreeInspector =
                        SequenceUiTreeInspector(
                            listOf(
                                UiWindowMetadata(foregroundPackage = "com.android.settings"),
                                UiWindowMetadata(foregroundPackage = "com.android.chrome"),
                                UiWindowMetadata(foregroundPackage = "com.android.settings"),
                            ),
                        ),
                    uiTreeFilterer = IdentityUiTreeFilterer,
                    uiTreeFormatter = unusedProxy(),
                    taskUiScope = unusedProxy(),
                    urlNavigator = unusedProxy(),
                    coroutineScopeIo = backgroundScope,
                )

            val result = async {
                taskScope.waitForNavigation(
                    expectedPackage = "com.android.settings",
                    expectedNode = null,
                    timeoutMs = 800,
                )
            }

            advanceUntilIdle()

            assertTrue(result.await().success)
        }

    @Test
    fun `readKeyValuePair reads summary from nearest sibling scope`() =
        actionTest {
            val uiScope =
                TaskUiScopeDefault(
                    uiTreeInspector =
                        StaticUiTreeInspector(
                            UiTree(
                                root =
                                    testNode(
                                        id = "root",
                                        role = UiRole.Container,
                                        children =
                                            listOf(
                                                testNode(
                                                    id = "row",
                                                    role = UiRole.Row,
                                                    children =
                                                        listOf(
                                                            testNode(
                                                                id = "column",
                                                                role = UiRole.Column,
                                                                children =
                                                                    listOf(
                                                                        testNode(
                                                                            id = "label",
                                                                            role = UiRole.Text,
                                                                            label = "Android version",
                                                                        ),
                                                                    ),
                                                            ),
                                                            testNode(
                                                                id = "summary",
                                                                role = UiRole.Text,
                                                                label = "16",
                                                                resourceId = "com.android.settings:id/summary",
                                                            ),
                                                        ),
                                                ),
                                            ),
                                    ),
                                windowId = 1,
                            ),
                        ),
                    uiTreeFilterer = IdentityUiTreeFilterer,
                    uiTreeFormatter = unusedProxy(),
                    uiTreeManager = unusedProxy(),
                    coroutineScopeIo = backgroundScope,
                )

            val result = uiScope.readKeyValuePair(NodeMatcher(textEquals = "Android version"), TaskRetry.None)

            assertEquals("Android version", result.first)
            assertEquals("16", result.second)
        }

    @Test
    fun `readKeyValuePair does not fall through to following row`() =
        actionTest {
            val uiScope =
                TaskUiScopeDefault(
                    uiTreeInspector =
                        StaticUiTreeInspector(
                            UiTree(
                                root =
                                    testNode(
                                        id = "root",
                                        role = UiRole.Container,
                                        children =
                                            listOf(
                                                testNode(
                                                    id = "row-1",
                                                    role = UiRole.Row,
                                                    children =
                                                        listOf(
                                                            testNode(
                                                                id = "label-1",
                                                                role = UiRole.Text,
                                                                label = "Security patch level",
                                                            ),
                                                        ),
                                                ),
                                                testNode(
                                                    id = "row-2",
                                                    role = UiRole.Row,
                                                    children =
                                                        listOf(
                                                            testNode(
                                                                id = "label-2",
                                                                role = UiRole.Text,
                                                                label = "Android version",
                                                            ),
                                                            testNode(
                                                                id = "summary-2",
                                                                role = UiRole.Text,
                                                                label = "16",
                                                                resourceId = "com.android.settings:id/summary",
                                                            ),
                                                        ),
                                                ),
                                            ),
                                    ),
                                windowId = 1,
                            ),
                        ),
                    uiTreeFilterer = IdentityUiTreeFilterer,
                    uiTreeFormatter = unusedProxy(),
                    uiTreeManager = unusedProxy(),
                    coroutineScopeIo = backgroundScope,
                )

            val error =
                assertFailsWith<IllegalStateException> {
                    uiScope.readKeyValuePair(NodeMatcher(textEquals = "Security patch level"), TaskRetry.None)
                }

            assertEquals("VALUE_NODE_NOT_FOUND", error.message)
        }

    @Test
    fun `wait_for_navigation times out when initial package metadata is null and target is already current`() =
        actionTest {
            // Bug: when initialPackage is null, shouldSatisfyExpectedPackage would
            // evaluate `null != expectedPackage` as true and return success immediately.
            // Correct behaviour: require a confirmed package change (observedDifferentPackage).
            val taskScope =
                TaskScopeDefault(
                    appsRepository = unusedProxy(),
                    triggerManager = unusedProxy(),
                    appCloseManager = unusedProxy(),
                    uiTreeInspector =
                        SequenceUiTreeInspector(
                            listOf(
                                // First poll: metadata unavailable (null)
                                null,
                                // Subsequent polls: package matches target but no transition observed
                                UiWindowMetadata(foregroundPackage = "com.android.settings"),
                                UiWindowMetadata(foregroundPackage = "com.android.settings"),
                            ),
                        ),
                    uiTreeFilterer = IdentityUiTreeFilterer,
                    uiTreeFormatter = unusedProxy(),
                    taskUiScope = unusedProxy(),
                    urlNavigator = unusedProxy(),
                    coroutineScopeIo = backgroundScope,
                )

            val result = async {
                taskScope.waitForNavigation(
                    expectedPackage = "com.android.settings",
                    expectedNode = null,
                    timeoutMs = 500,
                )
            }

            advanceUntilIdle()

            assertFalse(result.await().success)
        }

    @Test
    fun `wait_for_navigation succeeds for already foreground open_app when allowed`() =
        actionTest {
            val taskScope =
                TaskScopeDefault(
                    appsRepository = unusedProxy(),
                    triggerManager = unusedProxy(),
                    appCloseManager = unusedProxy(),
                    uiTreeInspector =
                        SequenceUiTreeInspector(
                            listOf(
                                UiWindowMetadata(foregroundPackage = "com.android.settings"),
                                UiWindowMetadata(foregroundPackage = "com.android.settings"),
                            ),
                        ),
                    uiTreeFilterer = IdentityUiTreeFilterer,
                    uiTreeFormatter = unusedProxy(),
                    taskUiScope = unusedProxy(),
                    urlNavigator = unusedProxy(),
                    coroutineScopeIo = backgroundScope,
                )

            val result =
                taskScope.waitForNavigation(
                    expectedPackage = "com.android.settings",
                    expectedNode = null,
                    timeoutMs = 500,
                    allowAlreadyForeground = true,
                )

            assertTrue(result.success)
            assertEquals("com.android.settings", result.lastPackage)
        }

    @Test
    fun `logUiTree returns exact XML without publishing an unverified agent log copy`() =
        actionTest {
            val hierarchyDump = buildString {
                append("<hierarchy>")
                repeat(4496) { index ->
                    append("<node index='$index' text='界😀 &amp; &lt;node escaped' />")
                }
                append("</hierarchy>")
            }
            val events = mutableListOf<TaskEvent>()
            val sink = object : TaskStatusSink {
                override fun emit(event: TaskEvent) { events += event }
            }
            val logTree = RecordingTimberTree()
            Timber.plant(logTree)
            try {
                val taskScope =
                    TaskScopeDefault(
                        appsRepository = unusedProxy(),
                        triggerManager = unusedProxy(),
                        appCloseManager = unusedProxy(),
                        uiTreeInspector = HierarchyDumpUiTreeInspector(hierarchyDump),
                        uiTreeFilterer = IdentityUiTreeFilterer,
                        uiTreeFormatter = unusedProxy(),
                        taskUiScope = unusedProxy(),
                        urlNavigator = unusedProxy(),
                        coroutineScopeIo = backgroundScope,
                    )

                val result =
                    withContext(EmptyCoroutineContext + TaskStatusElement(sink, "cmd-snapshot-log")) {
                        taskScope.logUiTree(TaskRetry.None)
                    }

                assertEquals(UiSnapshotActualFormat.HierarchyXml, result.actualFormat)
                assertEquals(hierarchyDump, result.hierarchyXml)
                assertEquals("4496", events.filterIsInstance<TaskEvent.StageSuccess>().single().data["node_count"])
                assertTrue(logTree.messages.none { (_, message) -> message.contains(hierarchyDump) })
            } finally {
                Timber.uproot(logTree)
            }
        }

    @Test
    fun `enterText emits clear failure context when setText fails`() =
        actionTest {
            val events = mutableListOf<TaskEvent>()
            val setTextCalls = mutableListOf<RecordedSetTextCall>()
            val sink =
                object : TaskStatusSink {
                    override fun emit(event: TaskEvent) {
                        events += event
                    }
                }
            val uiScope =
                TaskUiScopeDefault(
                    uiTreeInspector =
                        StaticUiTreeInspector(
                            UiTree(
                                root =
                                    testNode(
                                        id = "root",
                                        role = UiRole.Container,
                                        children =
                                            listOf(
                                                testNode(
                                                    id = "search",
                                                    role = UiRole.TextField,
                                                    resourceId = "com.example:id/search",
                                                ),
                                            ),
                                    ),
                                windowId = 1,
                            ),
                        ),
                    uiTreeFilterer = IdentityUiTreeFilterer,
                    uiTreeFormatter = unusedProxy(),
                    uiTreeManager =
                        object : UiTreeManager {
                            override suspend fun dragAt(startX: Int, startY: Int, endX: Int, endY: Int, holdDurationMs: Long, moveDurationMs: Long): Boolean = error("Unexpected drag")
                            override suspend fun swipeAt(startX: Int, startY: Int, endX: Int, endY: Int, durationMs: Long): Boolean = error("Unexpected swipe")
                            override suspend fun triggerClick(uiNode: UiNode, clickTypes: clawperator.uitree.UiTreeClickTypes): Boolean =
                                error("unused in test")

                            override suspend fun clickAt(
                                x: Float,
                                y: Float,
                                clickTypes: clawperator.uitree.UiTreeClickTypes,
                            ): Boolean = error("unused in test")

                            override suspend fun setText(
                                uiNode: UiNode,
                                text: String,
                                submit: Boolean,
                                clear: Boolean,
                            ): TextSubmissionOutcome? {
                                setTextCalls += RecordedSetTextCall(text = text, clear = clear, submit = submit)
                                return null
                            }

                            override suspend fun swipeWithinVertical(
                                uiNode: UiNode,
                                startYRatio: Float,
                                endYRatio: Float,
                                durationMs: Long,
                            ): Boolean = error("unused in test")

                            override suspend fun swipeWithinHorizontal(
                                uiNode: UiNode,
                                startXRatio: Float,
                                endXRatio: Float,
                                durationMs: Long,
                            ): Boolean = error("unused in test")
                        },
                    coroutineScopeIo = backgroundScope,
                )

            val error =
                withContext(EmptyCoroutineContext + TaskStatusElement(sink)) {
                    assertFailsWith<IllegalStateException> {
                        uiScope.enterText(
                            matcher = NodeMatcher(resourceId = "com.example:id/search"),
                            text = "hello",
                            submit = false,
                            clear = true,
                            retry = TaskRetry.None,
                        )
                    }
                }

            assertEquals("Failed to set text on matching UI node", error.message)
            assertEquals(listOf(RecordedSetTextCall(text = "hello", clear = true, submit = false)), setTextCalls)
            assertTrue(
                events.any { event ->
                    event is TaskEvent.StageFailure &&
                        event.id.contains("enterText(") &&
                        event.id.contains("resourceId=com.example:id/search") &&
                        event.reason == "Failed to set text on matching UI node"
                },
            )
            assertTrue(
                events.any { event ->
                    event is TaskEvent.Log &&
                        event.message.contains("failure_point=ACTION_FAILED") &&
                        event.message.contains("clear=true") &&
                        event.message.contains("submit=false")
                },
            )
        }

    @Test
    fun `enterText forwards default false clear and submit to setText`() =
        actionTest {
            val setTextCalls = mutableListOf<RecordedSetTextCall>()
            val uiScope =
                TaskUiScopeDefault(
                    uiTreeInspector =
                        StaticUiTreeInspector(
                            UiTree(
                                root =
                                    testNode(
                                        id = "root",
                                        role = UiRole.Container,
                                        children =
                                            listOf(
                                                testNode(
                                                    id = "search",
                                                    role = UiRole.TextField,
                                                    resourceId = "com.example:id/search",
                                                ),
                                            ),
                                    ),
                                windowId = 1,
                            ),
                        ),
                    uiTreeFilterer = IdentityUiTreeFilterer,
                    uiTreeFormatter = unusedProxy(),
                    uiTreeManager =
                        object : UiTreeManager {
                            override suspend fun dragAt(startX: Int, startY: Int, endX: Int, endY: Int, holdDurationMs: Long, moveDurationMs: Long): Boolean = error("Unexpected drag")
                            override suspend fun swipeAt(startX: Int, startY: Int, endX: Int, endY: Int, durationMs: Long): Boolean = error("Unexpected swipe")
                            override suspend fun triggerClick(uiNode: UiNode, clickTypes: clawperator.uitree.UiTreeClickTypes): Boolean =
                                error("unused in test")

                            override suspend fun clickAt(
                                x: Float,
                                y: Float,
                                clickTypes: clawperator.uitree.UiTreeClickTypes,
                            ): Boolean = error("unused in test")

                            override suspend fun setText(
                                uiNode: UiNode,
                                text: String,
                                submit: Boolean,
                                clear: Boolean,
                            ): TextSubmissionOutcome? {
                                setTextCalls += RecordedSetTextCall(text = text, clear = clear, submit = submit)
                                return if (submit) TextSubmissionOutcome.Unavailable else TextSubmissionOutcome.NotRequested
                            }

                            override suspend fun swipeWithinVertical(
                                uiNode: UiNode,
                                startYRatio: Float,
                                endYRatio: Float,
                                durationMs: Long,
                            ): Boolean = error("unused in test")

                            override suspend fun swipeWithinHorizontal(
                                uiNode: UiNode,
                                startXRatio: Float,
                                endXRatio: Float,
                                durationMs: Long,
                            ): Boolean = error("unused in test")
                        },
                    coroutineScopeIo = backgroundScope,
                )

            uiScope.enterText(
                matcher = NodeMatcher(resourceId = "com.example:id/search"),
                text = "hello",
                submit = false,
                retry = TaskRetry.None,
            )

            assertEquals(listOf(RecordedSetTextCall(text = "hello", clear = false, submit = false)), setTextCalls)
        }
}

private object IdentityUiTreeFilterer : UiTreeFilterer {
    override fun filterOnScreenOnly(uiTree: UiTree): UiTree = uiTree
}

private class StaticUiTreeInspector(
    private val uiTree: UiTree,
) : UiTreeInspector {
    override suspend fun getCurrentUiElements() = error("unused in test")

    override suspend fun getCurrentUiTree(): UiTree = uiTree

    override suspend fun getCurrentWindowMetadata(): UiWindowMetadata? = null

    override suspend fun getCurrentUiHierarchyDump(): String? = null
}

private class SequenceUiTreeInspector(
    private val metadataSequence: List<UiWindowMetadata?>,
) : UiTreeInspector {
    private var index = 0

    override suspend fun getCurrentUiElements() = error("unused in test")

    override suspend fun getCurrentUiTree(): UiTree? = null

    override suspend fun getCurrentWindowMetadata(): UiWindowMetadata? {
        val current = metadataSequence.getOrElse(index) { metadataSequence.last() }
        if (index < metadataSequence.lastIndex) {
            index++
        }
        return current
    }

    override suspend fun getCurrentUiHierarchyDump(): String? = null
}

private class HierarchyDumpUiTreeInspector(
    private val hierarchyDump: String,
    private val metadata: UiWindowMetadata? = null,
) : UiTreeInspector {
    override suspend fun getCurrentUiElements() = error("unused in test")

    override suspend fun getCurrentUiTree(): UiTree? = null

    override suspend fun getCurrentWindowMetadata(): UiWindowMetadata? = metadata

    override suspend fun getCurrentUiHierarchyDump(): String = hierarchyDump
}

private class RecordingTimberTree : Timber.Tree() {
    val messages = mutableListOf<Pair<String?, String>>()

    override fun log(
        priority: Int,
        tag: String?,
        message: String,
        t: Throwable?,
    ) {
        messages += tag to message
    }
}

private fun testNode(
    id: String,
    role: UiRole,
    label: String = "",
    resourceId: String? = null,
    children: List<UiNode> = emptyList(),
): UiNode =
    UiNode(
        id = UiNodeId(id),
        role = role,
        label = label,
        className = "test.${role.name}",
        bounds = Rect.Zero,
        isClickable = false,
        isEnabled = true,
        isVisible = true,
        resourceId = resourceId,
        children = children,
    )

@Suppress("UNCHECKED_CAST")
private inline fun <reified T> unusedProxy(): T =
    Proxy.newProxyInstance(
        T::class.java.classLoader,
        arrayOf(T::class.java),
    ) { _, method, _ ->
        when (method.name) {
            "toString" -> "unusedProxy(${T::class.java.simpleName})"
            else -> error("Unexpected call to ${T::class.java.simpleName}.${method.name}")
        }
    } as T
