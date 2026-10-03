package androperator.task.runner

import androperator.uitree.TextSubmissionOutcome
import action.developeroptions.DeveloperOptionsManager
import action.devicestate.DeviceState
import action.devicestate.DeviceStateMock
import action.math.geometry.Rect
import androperator.test.ActionTest
import androperator.test.actionTest
import androperator.uitree.ToggleState
import androperator.uitree.UiTreeClickTypes
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds

class UiActionEngineDefaultTest : ActionTest {
    @Test
    fun `selection warnings are attached to their action only and do not change success`() = actionTest {
        var clicks = 0
        val uiScope = object : RecordingTaskUiScope() {
            override suspend fun click(matcher: NodeMatcher?, coordinate: action.math.geometry.Point?, clickTypes: UiTreeClickTypes, retry: TaskRetry, strict: Boolean, container: NodeMatcher?) {
                if (clicks++ == 0) kotlin.coroutines.coroutineContext[SelectionWarnings]!!.record(7, container = false)
            }
        }
        val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())
        val result = engine.execute(RecordingTaskScope(uiScope), UiActionPlan("command", "task", "test", listOf(
            UiAction.Click("duplicates", NodeMatcher(resourceId = "target")),
            UiAction.Click("unique", NodeMatcher(resourceId = "unique")),
        )))
        assertEquals(2, clicks)
        assertTrue(result.stepResults.all { it.success })
        assertTrue(result.stepResults.first().data.getValue("selection_warning").contains("target: 7"))
        assertTrue(result.stepResults.first().data.getValue("selection_warning").contains("--strict"))
        assertFalse(result.stepResults.last().data.containsKey("selection_warning"))
        assertEquals(null, result.errorCode)
    }

    @Test
    fun `strict failures retain preceding steps correlation and stop subsequent actions`() = actionTest {
        var clicks = 0
        val uiScope = object : RecordingTaskUiScope() {
            override suspend fun queryUi(matcher: NodeMatcher?, visibility: String, limit: Int) = "{}"
            override suspend fun click(matcher: NodeMatcher?, coordinate: action.math.geometry.Point?, clickTypes: UiTreeClickTypes, retry: TaskRetry, strict: Boolean, container: NodeMatcher?) {
                assertTrue(strict)
                assertEquals("scope", container?.resourceId)
                clicks++
                throw StrictSelectionException("NODE_AMBIGUOUS", 2, "{}")
            }
        }
        val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())
        val result = engine.execute(RecordingTaskScope(uiScope), UiActionPlan("command", "task", "test", listOf(
            UiAction.QueryUi("before"),
            UiAction.Click("ambiguous", NodeMatcher(resourceId = "target"), strict = true, container = NodeMatcher(resourceId = "scope")),
            UiAction.Click("after", NodeMatcher(resourceId = "target")),
        )))
        assertEquals(1, clicks)
        assertEquals("command", result.commandId)
        assertEquals("task", result.taskId)
        assertEquals("NODE_AMBIGUOUS", result.errorCode)
        assertEquals(listOf("before", "ambiguous"), result.stepResults.map { it.id })
        assertFalse(result.stepResults.last().success)
        assertEquals("2", result.stepResults.last().data["candidate_count"])
    }

    @Test
    fun `unavailable query preserves completed steps and stops before later actions`() = actionTest {
        var captures = 0
        val diagnostics = androperator.uitree.UiHierarchyDiagnostics(serviceAvailable = true, windowCount = 2)
        val uiScope = object : RecordingTaskUiScope() {
            override suspend fun queryUi(matcher: NodeMatcher?, visibility: String, limit: Int): String {
                captures++
                if (captures == 2) throw QueryHierarchyUnavailableException(diagnostics)
                return "{}"
            }
        }
        val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())
        val plan = UiActionPlan("command", "task", "test", listOf(
            UiAction.QueryUi("before"), UiAction.QueryUi("missing"), UiAction.QueryUi("after"),
        ))
        val result = engine.execute(RecordingTaskScope(uiScope), plan)
        assertEquals(2, captures)
        assertEquals("command", result.commandId)
        assertEquals("task", result.taskId)
        assertEquals("UI_TREE_UNAVAILABLE", result.errorCode)
        assertEquals(listOf("before", "missing"), result.stepResults.map { it.id })
        assertTrue(result.stepResults.first().success)
        val failed = result.stepResults.last()
        assertFalse(failed.success)
        assertEquals("query_ui", failed.actionType)
        assertEquals(result.errorCode, failed.data["errorCode"])
        assertEquals(result.error, failed.data["error"])
        assertEquals(null, failed.data["query"])
        val evidence = kotlinx.serialization.json.Json.decodeFromString<androperator.uitree.UiHierarchyDiagnostics>(failed.data.getValue("diagnostics"))
        assertEquals(diagnostics, evidence)
        assertTrue(failed.data.getValue("diagnostics").contains("\"foregroundPackage\":null"))
    }

    @Test
    fun `query cancellation still propagates`() = actionTest {
        val uiScope = object : RecordingTaskUiScope() {
            override suspend fun queryUi(matcher: NodeMatcher?, visibility: String, limit: Int): String {
                throw kotlinx.coroutines.CancellationException("cancelled")
            }
        }
        val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())
        assertFailsWith<kotlinx.coroutines.CancellationException> {
            engine.execute(RecordingTaskScope(uiScope), UiActionPlan("command", "task", "test", listOf(UiAction.QueryUi("query"))))
        }
    }

    @Test
    fun `query returns intact data and overflow is a structured failed step`() =
        actionTest {
            val matcher = NodeMatcher(descendant = NodePredicate(textEquals = "Unique"))
            var overflow = false
            val uiScope =
                object : RecordingTaskUiScope() {
                    override suspend fun queryUi(
                        matcher: NodeMatcher?,
                        visibility: String,
                        limit: Int,
                    ): String {
                        assertEquals("Unique", matcher?.descendant?.textEquals)
                        assertEquals("all", visibility)
                        assertEquals(7, limit)
                        if (overflow) throw QueryPayloadTooLargeException()
                        return "{\"schemaVersion\":1}"
                    }
                }
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())
            val plan = UiActionPlan("query-command", "query-task", "test", listOf(UiAction.QueryUi("query", matcher, "all", 7)))
            val success = engine.execute(RecordingTaskScope(uiScope), plan)
            assertEquals("query-command", success.commandId)
            assertEquals("query-task", success.taskId)
            assertEquals("{\"schemaVersion\":1}", success.stepResults.single().data["query"])
            overflow = true
            val failed = engine.execute(RecordingTaskScope(uiScope), plan).stepResults.single()
            assertFalse(failed.success)
            assertEquals("PAYLOAD_TOO_LARGE", failed.data["error"])
            assertEquals(null, failed.data["query"])
        }


    @Test
    fun `execute runs generic action list and returns step data`() =
        actionTest {
            val uiScope = RecordingTaskUiScope()
            val taskScope = RecordingTaskScope(uiScope)
            val developerOptionsManager = DeveloperOptionsManagerMock()
            val engine = UiActionEngineDefault(developerOptionsManager, UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan =
                        UiActionPlan(
                            commandId = "cmd-1",
                            taskId = "task-1",
                            source = "test",
                            actions =
                                listOf(
                                    UiAction.OpenApp(id = "step-open", applicationId = "com.example.app"),
                                    UiAction.WaitForNode(
                                        id = "step-wait",
                                        matcher = nodeMatcher { resourceId("com.example:id/title") },
                                    ),
                                    UiAction.ReadText(
                                        id = "step-read",
                                        matcher = nodeMatcher { resourceId("com.example:id/title") },
                                    ),
                                    UiAction.SnapshotUi(id = "step-snapshot"),
                                ),
                        ),
                )

            assertEquals("cmd-1", result.commandId)
            assertEquals("task-1", result.taskId)
            assertEquals(4, result.stepResults.size)
            assertEquals("com.example.app", taskScope.openedApps.single())
            assertEquals(1, taskScope.logUiTreeCount)
            assertEquals("Title Text", result.stepResults.first { it.id == "step-read" }.data["text"])
        }

    @Test
    fun `execute open_app waits for foreground by default`() =
        actionTest {
            val uiScope = RecordingTaskUiScope()
            val taskScope = RecordingTaskScope(uiScope).apply {
                waitForNavigationResult = WaitForNavigationResult(success = true, lastPackage = "com.example.app", elapsedMs = 420)
            }
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan =
                        UiActionPlan(
                            commandId = "cmd-open-default",
                            taskId = "task-open-default",
                            source = "test",
                            actions =
                                listOf(
                                    UiAction.OpenApp(
                                        id = "step-open",
                                        applicationId = "com.example.app",
                                    ),
                                ),
                        ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("open_app", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("com.example.app", taskScope.openedApps.single())
            assertEquals(1, taskScope.waitForNavigationCallCount)
            assertTrue(taskScope.waitForNavigationCalledAfterOpenApp)
            assertTrue(taskScope.lastWaitForNavigationAllowAlreadyForeground)
            assertEquals("420", stepResult.data["navigation_elapsed_ms"])
            assertEquals("com.example.app", stepResult.data["resolved_package"])
        }

    @Test
    fun `execute open_app skipNavigationWait true returns without waiting`() =
        actionTest {
            val uiScope = RecordingTaskUiScope()
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan =
                        UiActionPlan(
                            commandId = "cmd-open-skip",
                            taskId = "task-open-skip",
                            source = "test",
                            actions =
                                listOf(
                                    UiAction.OpenApp(
                                        id = "step-open",
                                        applicationId = "com.example.app",
                                        skipNavigationWait = true,
                                    ),
                                ),
                        ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("open_app", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("com.example.app", taskScope.openedApps.single())
            assertEquals(0, taskScope.waitForNavigationCallCount)
            assertEquals("com.example.app", stepResult.data["application_id"])
            assertEquals(null, stepResult.data["navigation_elapsed_ms"])
        }

    @Test
    fun `execute open_app returns navigation timeout failure when wait times out`() =
        actionTest {
            val uiScope = RecordingTaskUiScope()
            val taskScope = RecordingTaskScope(uiScope).apply {
                waitForNavigationResult = WaitForNavigationResult(success = false, lastPackage = "com.wrong.app", elapsedMs = 5_000)
            }
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan =
                        UiActionPlan(
                            commandId = "cmd-open-timeout",
                            taskId = "task-open-timeout",
                            source = "test",
                            actions =
                                listOf(
                                    UiAction.OpenApp(
                                        id = "step-open",
                                        applicationId = "com.example.app",
                                    ),
                                ),
                        ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("open_app", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("NAVIGATION_TIMEOUT", stepResult.data["error"])
            assertEquals("com.example.app", stepResult.data["application_id"])
            assertEquals("com.wrong.app", stepResult.data["last_package"])
            assertEquals("5000", stepResult.data["navigation_elapsed_ms"])
            assertTrue(stepResult.data["message"]?.contains("foreground") == true)
            assertEquals(1, taskScope.waitForNavigationCallCount)
            assertTrue(taskScope.lastWaitForNavigationAllowAlreadyForeground)
        }

    @Test
    fun `execute click with coordinates uses raw coordinate tap`() =
        actionTest {
            val uiScope = RecordingTaskUiScope()
            val taskScope = RecordingTaskScope(uiScope)
            val developerOptionsManager = DeveloperOptionsManagerMock()
            val engine = UiActionEngineDefault(developerOptionsManager, UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan =
                        UiActionPlan(
                            commandId = "cmd-click-coordinate",
                            taskId = "task-click-coordinate",
                            source = "test",
                            actions =
                                listOf(
                                    UiAction.Click(
                                        id = "step-click",
                                        coordinate = action.math.geometry.Point(120, 240),
                                    ),
                                ),
                        ),
                )

            assertEquals(1, result.stepResults.size)
            assertEquals(action.math.geometry.Point(120, 240), uiScope.clickCoordinate)
        }

    @Test
    fun `execute enter_text reports submission evidence without changing requested submit`() = actionTest {
        for (outcome in TextSubmissionOutcome.entries) {
            val uiScope = RecordingTaskUiScope().apply { submissionOutcome = outcome }
            val submitRequested = outcome != TextSubmissionOutcome.NotRequested
            val result = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock()).execute(
                taskScope = RecordingTaskScope(uiScope),
                plan = UiActionPlan(
                    commandId = "cmd-text-evidence", taskId = "task-text-evidence", source = "test",
                    actions = listOf(UiAction.EnterText(
                        id = "type", matcher = nodeMatcher { resourceId("com.example:id/search") },
                        text = "hello", submit = submitRequested,
                    )),
                ),
            )
            val step = result.stepResults.single()
            assertTrue(step.success)
            assertEquals("accepted", step.data["text_entry"])
            assertEquals(submitRequested.toString(), step.data["submit"])
            assertEquals(outcome.wireValue, step.data["submit_method"])
            assertEquals(when (outcome) {
                TextSubmissionOutcome.NotRequested -> "not_requested"
                TextSubmissionOutcome.Unavailable -> "unavailable"
                else -> "accepted"
            }, step.data["submission"])
        }
    }

    @Test
    fun `execute enter_text forwards clear true`() =
        actionTest {
            val uiScope = RecordingTaskUiScope()
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan =
                        UiActionPlan(
                            commandId = "cmd-enter-text-clear",
                            taskId = "task-enter-text-clear",
                            source = "test",
                            actions =
                                listOf(
                                    UiAction.EnterText(
                                        id = "type-1",
                                        matcher = nodeMatcher { resourceId("com.example:id/search") },
                                        text = "hello",
                                        submit = false,
                                        clear = true,
                                    ),
                                ),
                        ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("enter_text", stepResult.actionType)
            assertEquals("hello", uiScope.enteredText)
            assertEquals(true, uiScope.enterTextClear)
            assertEquals(false, uiScope.enterTextSubmit)
            assertEquals("true", stepResult.data["clear"])
        }

    @Test
    fun `execute enter_text forwards clear false`() =
        actionTest {
            val uiScope = RecordingTaskUiScope()
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan =
                        UiActionPlan(
                            commandId = "cmd-enter-text-no-clear",
                            taskId = "task-enter-text-no-clear",
                            source = "test",
                            actions =
                                listOf(
                                    UiAction.EnterText(
                                        id = "type-1",
                                        matcher = nodeMatcher { resourceId("com.example:id/search") },
                                        text = "hello",
                                        submit = true,
                                        clear = false,
                                    ),
                                ),
                        ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("enter_text", stepResult.actionType)
            assertEquals("hello", uiScope.enteredText)
            assertEquals(false, uiScope.enterTextClear)
            assertEquals(true, uiScope.enterTextSubmit)
            assertEquals("false", stepResult.data["clear"])
        }

    @Test
    fun `execute enter_text defaults clear false when omitted`() =
        actionTest {
            val uiScope = RecordingTaskUiScope()
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan =
                        UiActionPlan(
                            commandId = "cmd-enter-text-default-clear",
                            taskId = "task-enter-text-default-clear",
                            source = "test",
                            actions =
                                listOf(
                                    UiAction.EnterText(
                                        id = "type-1",
                                        matcher = nodeMatcher { resourceId("com.example:id/search") },
                                        text = "hello",
                                        submit = true,
                                    ),
                                ),
                        ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("enter_text", stepResult.actionType)
            assertEquals("hello", uiScope.enteredText)
            assertEquals(false, uiScope.enterTextClear)
            assertEquals(true, uiScope.enterTextSubmit)
            assertEquals("false", stepResult.data["clear"])
        }

    @Test
    fun `execute snapshot_ui returns XML with overlay metadata in the canonical step`() =
        actionTest {
            val uiScope = RecordingTaskUiScope()
            val taskScope =
                RecordingTaskScope(
                    uiScope = uiScope,
                    snapshotResult =
                        UiSnapshotResult(
                            actualFormat = UiSnapshotActualFormat.HierarchyXml,
                            hierarchyXml = "<hierarchy><node text='界😀 &amp; settings'/></hierarchy>",
                            foregroundPackage = "com.android.permissioncontroller",
                            hasOverlay = true,
                            overlayPackage = "com.android.permissioncontroller",
                            windowCount = 2,
                            operatorOverlayVisible = true,
                        ),
                )
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan =
                        UiActionPlan(
                            commandId = "cmd-snapshot-overlay",
                            taskId = "task-snapshot-overlay",
                            source = "test",
                            actions = listOf(UiAction.SnapshotUi(id = "snap-1")),
                        ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("snapshot_ui", stepResult.actionType)
            assertEquals("hierarchy_xml", stepResult.data["actual_format"])
            assertEquals("<hierarchy><node text='界😀 &amp; settings'/></hierarchy>", stepResult.data["text"])
            assertEquals("com.android.permissioncontroller", stepResult.data["foreground_package"])
            assertEquals("true", stepResult.data["has_overlay"])
            assertEquals("com.android.permissioncontroller", stepResult.data["overlay_package"])
            assertEquals("2", stepResult.data["window_count"])
            assertEquals("true", stepResult.data["operator_overlay_visible"])
        }

    @Test
    fun `execute doctor_ping reports direct device-state diagnostics`() =
        actionTest {
            val taskScope = RecordingTaskScope(RecordingTaskUiScope())
            val deviceState =
                DirectQueryDeviceStateFake(
                    queryScreenOnValue = false,
                    eventedScreenOnValue = true,
                    queryDeviceLockedValue = true,
                    eventedDeviceLockedValue = false,
                    userUnlockedValue = false,
                )
            val engine =
                UiActionEngineDefault(
                    DeveloperOptionsManagerMock(),
                    UiGlobalActionDispatcherMock(),
                    deviceState,
                )

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan =
                        UiActionPlan(
                            commandId = "cmd-doctor-ping",
                            taskId = "task-doctor-ping",
                            source = "test",
                            actions = listOf(UiAction.DoctorPing(id = "doctor-1")),
                        ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("doctor_ping", stepResult.actionType)
            assertEquals("true", stepResult.data["developer_options_enabled"])
            assertEquals("true", stepResult.data["usb_debugging_enabled"])
            assertEquals("false", stepResult.data["screen_on"])
            assertEquals("true", stepResult.data["device_locked"])
            assertEquals("false", stepResult.data["user_unlocked"])
        }

    @Test
    fun `execute scroll_and_click uses TaskUiScope primitives`() =
        actionTest {
            val uiScope = RecordingTaskUiScope()
            val taskScope = RecordingTaskScope(uiScope)
            val developerOptionsManager = DeveloperOptionsManagerMock()
            val engine = UiActionEngineDefault(developerOptionsManager, UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan =
                        UiActionPlan(
                            commandId = "cmd-2",
                            taskId = "task-2",
                            source = "test",
                            actions =
                                listOf(
                                    UiAction.ScrollAndClick(
                                        id = "step-scroll-click",
                                        matcher = nodeMatcher { textContains("Bedroom") },
                                        direction = TaskScrollDirection.Down,
                                        maxSwipes = 3,
                                        clickTypes = UiTreeClickTypes.Click,
                                    ),
                                ),
                        ),
                )

            assertEquals("step-scroll-click", result.stepResults.single().id)
            assertTrue(uiScope.scrollIntoViewCalled)
            assertTrue(uiScope.clickCalled)
        }

    @Test
    fun `execute close_app returns unsupported error result`() =
        actionTest {
            val uiScope = RecordingTaskUiScope()
            val taskScope = RecordingTaskScope(uiScope)
            val developerOptionsManager = DeveloperOptionsManagerMock()
            val engine = UiActionEngineDefault(developerOptionsManager, UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan =
                        UiActionPlan(
                            commandId = "cmd-close",
                            taskId = "task-close",
                            source = "test",
                            actions =
                                listOf(
                                    UiAction.CloseApp(id = "step-close", applicationId = "com.example.app"),
                                ),
                        ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("step-close", stepResult.id)
            assertEquals("close_app", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("UNSUPPORTED_RUNTIME_CLOSE", stepResult.data["error"])
            assertTrue(stepResult.data["message"]?.contains("Android runtime cannot reliably close apps") == true)
        }

    @Test
    fun `bridge-only TV button preserves explicit unsupported runtime failure`() = actionTest {
        val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(),
            UiGlobalActionDispatcherMock(error = UiActionFailure("UNSUPPORTED_RUNTIME_TV_REMOTE", "Use Node bridge")))
        val result = engine.execute(RecordingTaskScope(RecordingTaskUiScope()),
            UiActionPlan("tv-command", "tv-task", "test", listOf(UiAction.PressKey("button", UiSystemKey.BOOKMARK))))
        assertEquals("tv-command", result.commandId)
        assertEquals("tv-task", result.taskId)
        assertEquals("UNSUPPORTED_RUNTIME_TV_REMOTE", result.errorCode)
        assertFalse(result.stepResults.single().success)
    }

    @Test
    fun `execute press_key preserves typed service failure`() = actionTest {
        val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(),
            UiGlobalActionDispatcherMock(error = UiActionFailure("SERVICE_UNAVAILABLE", "Service unavailable")))
        val result = engine.execute(RecordingTaskScope(RecordingTaskUiScope()),
            UiActionPlan("command", "task", "test", listOf(UiAction.PressKey("key", UiSystemKey.BACK))))
        assertEquals("SERVICE_UNAVAILABLE", result.errorCode)
        assertEquals("Service unavailable", result.stepResults.single().data["error"])
    }

    @Test
    fun `execute press_key returns success result when global action succeeds`() =
        actionTest {
            val taskScope = RecordingTaskScope(RecordingTaskUiScope())
            val engine =
                UiActionEngineDefault(
                    DeveloperOptionsManagerMock(),
                    UiGlobalActionDispatcherMock(result = true),
                )

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd-key-success",
                        taskId = "task-key-success",
                        source = "test",
                        actions = listOf(UiAction.PressKey(id = "k1", key = UiSystemKey.HOME)),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("press_key", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("home", stepResult.data["key"])
        }

    @Test
    fun `execute press_key returns failed step result when global action is rejected`() =
        actionTest {
            val taskScope = RecordingTaskScope(RecordingTaskUiScope())
            val engine =
                UiActionEngineDefault(
                    DeveloperOptionsManagerMock(),
                    UiGlobalActionDispatcherMock(result = false),
                )

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd-key-failed",
                        taskId = "task-key-failed",
                        source = "test",
                        actions = listOf(UiAction.PressKey(id = "k1", key = UiSystemKey.RECENTS)),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("press_key", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("recents", stepResult.data["key"])
            assertEquals("GLOBAL_ACTION_FAILED", stepResult.data["error"])
        }

    @Test
    fun `execute scroll returns moved when scrollOnce returns Moved`() =
        actionTest {
            val uiScope = RecordingTaskUiScope(scrollOnceOutcome = TaskScrollOutcome.Moved)
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd-scroll-moved",
                        taskId = "task-scroll-moved",
                        source = "test",
                        actions = listOf(UiAction.Scroll(id = "s1", direction = TaskScrollDirection.Down)),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("scroll", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("moved", stepResult.data["scroll_outcome"])
            assertEquals("down", stepResult.data["direction"])
            assertTrue(uiScope.scrollOnceCalled)
        }

    @Test
    fun `execute scroll returns edge_reached when scrollOnce returns EdgeReached`() =
        actionTest {
            val uiScope = RecordingTaskUiScope(scrollOnceOutcome = TaskScrollOutcome.EdgeReached)
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd-scroll-edge",
                        taskId = "task-scroll-edge",
                        source = "test",
                        actions = listOf(UiAction.Scroll(id = "s2", direction = TaskScrollDirection.Up)),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("scroll", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("edge_reached", stepResult.data["scroll_outcome"])
            assertEquals("up", stepResult.data["direction"])
        }

    @Test
    fun `execute scroll returns failure when scrollOnce returns GestureFailed`() =
        actionTest {
            val uiScope = RecordingTaskUiScope(scrollOnceOutcome = TaskScrollOutcome.GestureFailed)
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd-scroll-gesture-failed",
                        taskId = "task-scroll-gesture-failed",
                        source = "test",
                        actions = listOf(UiAction.Scroll(id = "s3")),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("scroll", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("gesture_failed", stepResult.data["scroll_outcome"])
            assertEquals("GESTURE_FAILED", stepResult.data["error"])
        }

    @Test
    fun `execute scroll returns container_not_found when scrollOnce throws no scrollable container`() =
        actionTest {
            val uiScope = RecordingTaskUiScope(scrollOnceThrows = UiActionFailure("CONTAINER_NOT_FOUND", "No scrollable container visible"))
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd-scroll-no-container",
                        taskId = "task-scroll-no-container",
                        source = "test",
                        actions = listOf(UiAction.Scroll(id = "s4")),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("scroll", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("CONTAINER_NOT_FOUND", stepResult.data["error"])
        }

    @Test
    fun `execute scroll returns container_not_scrollable when scrollOnce throws not scrollable`() =
        actionTest {
            val uiScope = RecordingTaskUiScope(scrollOnceThrows = UiActionFailure("CONTAINER_NOT_SCROLLABLE", "Scrollable container not found for matcher"))
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd-scroll-not-scrollable",
                        taskId = "task-scroll-not-scrollable",
                        source = "test",
                        actions = listOf(UiAction.Scroll(id = "s5")),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("scroll", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("CONTAINER_NOT_SCROLLABLE", stepResult.data["error"])
        }

    @Test
    fun `execute scroll_until returns edge_reached termination`() =
        actionTest {
            val uiScope = RecordingTaskUiScope(
                scrollLoopResult = TaskScrollLoopResult(TaskScrollTerminationReason.EdgeReached, scrollsExecuted = 7),
            )
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd-su-edge",
                        taskId = "task-su-edge",
                        source = "test",
                        actions = listOf(UiAction.ScrollUntil(id = "su1", direction = TaskScrollDirection.Down)),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("scroll_until", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("EDGE_REACHED", stepResult.data["termination_reason"])
            assertEquals("7", stepResult.data["scrolls_executed"])
            assertEquals("down", stepResult.data["direction"])
        }

    @Test
    fun `execute scroll_until returns max_scrolls_reached termination`() =
        actionTest {
            val uiScope = RecordingTaskUiScope(
                scrollLoopResult = TaskScrollLoopResult(TaskScrollTerminationReason.MaxScrollsReached, scrollsExecuted = 20),
            )
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd-su-maxscrolls",
                        taskId = "task-su-maxscrolls",
                        source = "test",
                        actions = listOf(UiAction.ScrollUntil(id = "su2")),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("scroll_until", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("MAX_SCROLLS_REACHED", stepResult.data["termination_reason"])
            assertEquals("20", stepResult.data["scrolls_executed"])
        }

    @Test
    fun `execute scroll_until returns no_position_change termination`() =
        actionTest {
            val uiScope = RecordingTaskUiScope(
                scrollLoopResult = TaskScrollLoopResult(TaskScrollTerminationReason.NoPositionChange, scrollsExecuted = 4),
            )
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd-su-npc",
                        taskId = "task-su-npc",
                        source = "test",
                        actions = listOf(UiAction.ScrollUntil(id = "su3")),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("scroll_until", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("NO_POSITION_CHANGE", stepResult.data["termination_reason"])
        }

    @Test
    fun `execute scroll_until returns failure for container_not_found`() =
        actionTest {
            val uiScope = RecordingTaskUiScope(
                scrollLoopResult = TaskScrollLoopResult(TaskScrollTerminationReason.ContainerNotFound, scrollsExecuted = 0),
            )
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd-su-cnf",
                        taskId = "task-su-cnf",
                        source = "test",
                        actions = listOf(UiAction.ScrollUntil(id = "su4")),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("scroll_until", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("CONTAINER_NOT_FOUND", stepResult.data["error"])
            assertEquals("CONTAINER_NOT_FOUND", stepResult.data["termination_reason"])
        }

    @Test
    fun `execute scroll_until returns failure for container_lost`() =
        actionTest {
            val uiScope = RecordingTaskUiScope(
                scrollLoopResult = TaskScrollLoopResult(TaskScrollTerminationReason.ContainerLost, scrollsExecuted = 3),
            )
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd-su-cl",
                        taskId = "task-su-cl",
                        source = "test",
                        actions = listOf(UiAction.ScrollUntil(id = "su5")),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("scroll_until", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("CONTAINER_LOST", stepResult.data["error"])
            assertEquals("CONTAINER_LOST", stepResult.data["termination_reason"])
        }

    @Test
    fun `execute scroll_until returns target_found termination`() =
        actionTest {
            val uiScope = RecordingTaskUiScope(
                scrollLoopResult = TaskScrollLoopResult(TaskScrollTerminationReason.TargetFound, scrollsExecuted = 3),
            )
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd-su-target",
                        taskId = "task-su-target",
                        source = "test",
                        actions = listOf(
                            UiAction.ScrollUntil(
                                id = "su-target",
                                matcher = NodeMatcher(textContains = "About phone"),
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("scroll_until", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("TARGET_FOUND", stepResult.data["termination_reason"])
            assertEquals("3", stepResult.data["scrolls_executed"])
        }

    @Test
    fun `execute scroll_until clicks target when clickAfter is true`() =
        actionTest {
            val uiScope = RecordingTaskUiScope(
                scrollLoopResult = TaskScrollLoopResult(TaskScrollTerminationReason.TargetFound, scrollsExecuted = 3),
            )
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd-su-target-click",
                        taskId = "task-su-target-click",
                        source = "test",
                        actions = listOf(
                            UiAction.ScrollUntil(
                                id = "su-target-click",
                                matcher = NodeMatcher(textContains = "About phone"),
                                clickAfter = true,
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("scroll_until", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("TARGET_FOUND", stepResult.data["termination_reason"])
            assertEquals("true", stepResult.data["click_after"])
            assertEquals(true, uiScope.clickCalled)
        }

    @Test
    fun `execute scroll_until returns edge_reached when target genuinely absent`() =
        actionTest {
            val uiScope = RecordingTaskUiScope(
                scrollLoopResult = TaskScrollLoopResult(TaskScrollTerminationReason.EdgeReached, scrollsExecuted = 3),
                waitForNodeThrows = IllegalStateException("Node not found"),
            )
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd-su-absent-click",
                        taskId = "task-su-absent-click",
                        source = "test",
                        actions = listOf(
                            UiAction.ScrollUntil(
                                id = "su-absent-click",
                                matcher = NodeMatcher(textContains = "Missing Target"),
                                clickAfter = true,
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("scroll_until", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("EDGE_REACHED", stepResult.data["termination_reason"])
            assertEquals("TARGET_NOT_FOUND", stepResult.data["error"])
            assertEquals("true", stepResult.data["click_after"])
            assertEquals(false, uiScope.clickCalled)
        }

    @Test
    fun `execute scroll_until does not replace exhausted scoped search with a global target wait`() = actionTest {
        for (scrolls in listOf(0, 2)) for (reason in listOf(TaskScrollTerminationReason.EdgeReached, TaskScrollTerminationReason.MaxScrollsReached,
            TaskScrollTerminationReason.MaxDurationReached, TaskScrollTerminationReason.NoPositionChange)) {
            val uiScope = RecordingTaskUiScope(scrollLoopResult = TaskScrollLoopResult(reason, scrollsExecuted = scrolls))
            val result = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock()).execute(
                taskScope = RecordingTaskScope(uiScope),
                plan = UiActionPlan(commandId = "scoped-search", taskId = "scoped-search", source = "test",
                    actions = listOf(UiAction.ScrollUntil(id = "search", matcher = NodeMatcher(textEquals = "Target"), clickAfter = true))),
            )
            val step = result.stepResults.single()
            assertFalse(step.success)
            assertEquals(mapOf(TaskScrollTerminationReason.EdgeReached to "EDGE_REACHED",
                TaskScrollTerminationReason.MaxScrollsReached to "MAX_SCROLLS_REACHED",
                TaskScrollTerminationReason.MaxDurationReached to "MAX_DURATION_REACHED",
                TaskScrollTerminationReason.NoPositionChange to "NO_POSITION_CHANGE")[reason], step.data["termination_reason"])
            assertFalse(uiScope.clickCalled)
        }
    }
    @Test
    fun `execute wait_for_navigation returns success on resolution`() =
        actionTest {
            val uiScope = RecordingTaskUiScope()
            val taskScope = RecordingTaskScope(uiScope).apply {
                waitForNavigationResult = WaitForNavigationResult(success = true, lastPackage = "com.example", elapsedMs = 150)
            }
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.WaitForNavigation(
                                id = "wait1",
                                expectedPackage = "com.example",
                                timeoutMs = 5000,
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("wait_for_navigation", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("com.example", stepResult.data["resolved_package"])
            assertEquals("150", stepResult.data["elapsed_ms"])
        }

    @Test
    fun `execute wait_for_navigation returns failure on timeout`() =
        actionTest {
            val uiScope = RecordingTaskUiScope()
            val taskScope = RecordingTaskScope(uiScope).apply {
                waitForNavigationResult = WaitForNavigationResult(success = false, lastPackage = "com.wrong", elapsedMs = 5000)
            }
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.WaitForNavigation(
                                id = "wait2",
                                expectedPackage = "com.example",
                                timeoutMs = 5000,
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("wait_for_navigation", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("NAVIGATION_TIMEOUT", stepResult.data["error"])
            assertEquals("com.wrong", stepResult.data["last_package"])
        }

    @Test
    fun `execute wait_for_navigation succeeds with expectedNode`() =
        actionTest {
            val uiScope = RecordingTaskUiScope()
            val taskScope = RecordingTaskScope(uiScope).apply {
                waitForNavigationResult = WaitForNavigationResult(success = true, lastPackage = "com.example", elapsedMs = 320)
            }
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.WaitForNavigation(
                                id = "wait3",
                                expectedNode = NodeMatcher(textEquals = "Success"),
                                timeoutMs = 5000,
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("wait_for_navigation", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("com.example", stepResult.data["resolved_package"])
            assertEquals("320", stepResult.data["elapsed_ms"])
        }

    @Test
    fun `execute read_key_value_pair returns label and value on success`() =
        actionTest {
            val uiScope = RecordingTaskUiScope().apply {
                readKeyValuePairResult = Pair("Android version", "16")
            }
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.ReadKeyValuePair(
                                id = "kvp1",
                                labelMatcher = NodeMatcher(textEquals = "Android version"),
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("read_key_value_pair", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("Android version", stepResult.data["label"])
            assertEquals("16", stepResult.data["value"])
        }

    @Test
    fun `execute read_key_value_pair returns failure when label not found`() =
        actionTest {
            val uiScope = RecordingTaskUiScope().apply {
                readKeyValuePairThrows = IllegalStateException("NODE_NOT_FOUND")
            }
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.ReadKeyValuePair(
                                id = "kvp2",
                                labelMatcher = NodeMatcher(textEquals = "Missing"),
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("read_key_value_pair", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("NODE_NOT_FOUND", stepResult.data["error"])
        }

    @Test
    fun `execute read_key_value_pair returns failure when value not found`() =
        actionTest {
            val uiScope = RecordingTaskUiScope().apply {
                readKeyValuePairThrows = IllegalStateException("VALUE_NODE_NOT_FOUND")
            }
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.ReadKeyValuePair(
                                id = "kvp3",
                                labelMatcher = NodeMatcher(textEquals = "Label Only"),
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("read_key_value_pair", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("VALUE_NODE_NOT_FOUND", stepResult.data["error"])
        }

    @Test
    fun `unknown failures retain prior steps original text and stop the sequence`() = actionTest {
        val uiScope = RecordingTaskUiScope().apply { readKeyValuePairThrows = IllegalStateException("Original failure") }
        val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())
        val result = engine.execute(RecordingTaskScope(uiScope), UiActionPlan("command", "task", "test", listOf(
            UiAction.Sleep("before", 0),
            UiAction.ReadKeyValuePair("failed", NodeMatcher(textEquals = "Label")),
            UiAction.Sleep("after", 0),
        )))
        assertEquals("ACTION_FAILED", result.errorCode)
        assertEquals("Original failure", result.error)
        assertEquals(listOf("before", "failed"), result.stepResults.map { it.id })
        assertEquals("read_key_value_pair", result.stepResults.last().actionType)
        assertEquals("ACTION_FAILED", result.stepResults.last().data["errorCode"])
    }

    @Test
    fun `wait timeout retains completed step and failed wait`() = actionTest {
        val uiScope = object : RecordingTaskUiScope() {
            override suspend fun waitForNode(matcher: NodeMatcher, retry: TaskRetry, timeoutMs: Long?, strict: Boolean, container: NodeMatcher?): TaskUiNode {
                throw UiActionFailure("WAIT_TIMEOUT", "Wait expired")
            }
        }
        val result = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())
            .execute(RecordingTaskScope(uiScope), UiActionPlan("command", "task", "test", listOf(
                UiAction.Sleep("before", 0), UiAction.WaitForNode("wait", NodeMatcher(textEquals = "Missing")), UiAction.Sleep("after", 0))))
        assertEquals("WAIT_TIMEOUT", result.errorCode)
        assertEquals(listOf("before", "wait"), result.stepResults.map { it.id })
        assertEquals("wait_for_node", result.stepResults.last().actionType)
    }

    @Test
    fun `cancellation propagates while preserving completed and interrupted steps`() = actionTest {
        val journal = ActionExecutionJournal()
        val uiScope = object : RecordingTaskUiScope() {
            override suspend fun waitForNode(matcher: NodeMatcher, retry: TaskRetry, timeoutMs: Long?, strict: Boolean, container: NodeMatcher?): TaskUiNode {
                kotlinx.coroutines.awaitCancellation()
            }
        }
        val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())
        kotlinx.coroutines.withContext(journal) {
            val timedOut = kotlinx.coroutines.withTimeoutOrNull(100) {
                engine.execute(RecordingTaskScope(uiScope), UiActionPlan("command", "task", "test", listOf(
                    UiAction.Sleep("before", 0), UiAction.WaitForNode("wait", NodeMatcher(textEquals = "Missing")), UiAction.Sleep("after", 0))))
            }
            assertEquals(null, timedOut)
        }
        assertEquals(listOf("before", "wait"), journal.steps.map { it.id })
        assertEquals("COMMAND_TIMEOUT", journal.steps.last().data["errorCode"])
    }

    @Test
    fun `returned failed steps continue the sequence without a terminal exception code`() = actionTest {
        val result = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())
            .execute(RecordingTaskScope(RecordingTaskUiScope()), UiActionPlan("command", "task", "test", listOf(
                UiAction.CloseApp("failed", "com.example.app"), UiAction.Sleep("after", 0))))
        assertEquals(listOf(false, true), result.stepResults.map { it.success })
        assertEquals(null, result.errorCode)
    }

    @Test
    fun `execute read_text with version validator succeeds`() =
        actionTest {
            val uiScope = object : RecordingTaskUiScope() {
                override suspend fun getValidatedText(
                    matcher: NodeMatcher,
                    retry: TaskRetry,
                    strict: Boolean,
                    validator: (String) -> Boolean,
                ): String {
                    val value = "16.0.1"
                    if (!validator(value)) {
                        throw IllegalStateException("Validation failed for text '$value' from matching UI node")
                    }
                    return value
                }
            }
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.ReadText(
                                id = "rt1",
                                matcher = NodeMatcher(textContains = "Version"),
                                validator = UiTextValidator.Version,
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("read_text", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("16.0.1", stepResult.data["text"])
        }

    @Test
    fun `execute read_text with version validator fails`() =
        actionTest {
            val uiScope = object : RecordingTaskUiScope() {
                override suspend fun getValidatedText(
                    matcher: NodeMatcher,
                    retry: TaskRetry,
                    strict: Boolean,
                    validator: (String) -> Boolean,
                ): String {
                    val value = "Settings"
                    if (!validator(value)) {
                        throw IllegalStateException("Validation failed for text '$value' from matching UI node")
                    }
                    return value
                }
            }
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.ReadText(
                                id = "rt2",
                                matcher = NodeMatcher(textContains = "Settings"),
                                validator = UiTextValidator.Version,
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("read_text", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("VALIDATOR_MISMATCH", stepResult.data["error"])
            assertEquals("Settings", stepResult.data["raw_text"])
        }

    @Test
    fun `execute read_text with temperature validator fails`() =
        actionTest {
            val uiScope = object : RecordingTaskUiScope() {
                override suspend fun getValidatedText(
                    matcher: NodeMatcher,
                    retry: TaskRetry,
                    strict: Boolean,
                    validator: (String) -> Boolean,
                ): String {
                    val value = "not a temperature"
                    if (!validator(value)) {
                        throw IllegalStateException("Validation failed for text '$value' from matching UI node")
                    }
                    return value
                }
            }
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.ReadText(
                                id = "rt-temp",
                                matcher = NodeMatcher(textContains = "Temp"),
                                validator = UiTextValidator.Temperature,
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("read_text", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("VALIDATOR_MISMATCH", stepResult.data["error"])
            assertEquals("not a temperature", stepResult.data["raw_text"])
        }

    @Test
    fun `execute read_text with regex validator succeeds`() =
        actionTest {
            val uiScope = object : RecordingTaskUiScope() {
                override suspend fun getValidatedText(
                    matcher: NodeMatcher,
                    retry: TaskRetry,
                    strict: Boolean,
                    validator: (String) -> Boolean,
                ): String {
                    val value = "123-456"
                    if (!validator(value)) {
                        throw IllegalStateException("Validation failed for text '$value' from matching UI node")
                    }
                    return value
                }
            }
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.ReadText(
                                id = "rt3",
                                matcher = NodeMatcher(resourceId = "id"),
                                validator = UiTextValidator.Regex,
                                validatorPattern = "^\\d{3}-\\d{3}$",
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("read_text", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("123-456", stepResult.data["text"])
        }

    @Test
    fun `execute read_text with regex validator fails`() =
        actionTest {
            val uiScope = object : RecordingTaskUiScope() {
                override suspend fun getValidatedText(
                    matcher: NodeMatcher,
                    retry: TaskRetry,
                    strict: Boolean,
                    validator: (String) -> Boolean,
                ): String {
                    val value = "abc"
                    if (!validator(value)) {
                        throw IllegalStateException("Validation failed for text '$value' from matching UI node")
                    }
                    return value
                }
            }
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.ReadText(
                                id = "rt4",
                                matcher = NodeMatcher(resourceId = "id"),
                                validator = UiTextValidator.Regex,
                                validatorPattern = "^\\d{3}-\\d{3}$",
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("read_text", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("VALIDATOR_MISMATCH", stepResult.data["error"])
            assertEquals("abc", stepResult.data["raw_text"])
        }

    @Test
    fun `execute read_text with container succeeds`() =
        actionTest {
            var capturedMatcher: NodeMatcher? = null
            var capturedContainer: NodeMatcher? = null
            val uiScope = object : RecordingTaskUiScope() {
                override suspend fun getTextWithinContainer(
                    matcher: NodeMatcher,
                    containerMatcher: NodeMatcher,
                    retry: TaskRetry,
                    strict: Boolean,
                ): String {
                    capturedMatcher = matcher
                    capturedContainer = containerMatcher
                    return "Found in container"
                }
            }
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val expectedMatcher = NodeMatcher(textContains = "Item")
            val expectedContainer = NodeMatcher(resourceId = "com.example:id/list")

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.ReadText(
                                id = "rt-container",
                                matcher = expectedMatcher,
                                container = expectedContainer,
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("read_text", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("Found in container", stepResult.data["text"])
            assertEquals("none", stepResult.data["validator"])
            assertEquals(expectedMatcher, capturedMatcher)
            assertEquals(expectedContainer, capturedContainer)
            assertTrue(stepResult.data.containsKey("container"))
            assertFalse(stepResult.data["container"].isNullOrBlank())
        }

    @Test
    fun `execute read_text with container not found fails`() =
        actionTest {
            var capturedContainer: NodeMatcher? = null
            val uiScope = object : RecordingTaskUiScope() {
                override suspend fun getTextWithinContainer(
                    matcher: NodeMatcher,
                    containerMatcher: NodeMatcher,
                    retry: TaskRetry,
                    strict: Boolean,
                ): String {
                    capturedContainer = containerMatcher
                    throw IllegalStateException("Container not found for: $containerMatcher")
                }
            }
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val expectedContainer = NodeMatcher(resourceId = "com.example:id/nonexistent")

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.ReadText(
                                id = "rt-container-missing",
                                matcher = NodeMatcher(textContains = "Item"),
                                container = expectedContainer,
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("read_text", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("CONTAINER_NOT_FOUND", stepResult.data["error"])
            assertEquals(expectedContainer, capturedContainer)
        }

    @Test
    fun `execute read_text with container but target not in subtree fails with node_not_found`() =
        actionTest {
            var capturedContainer: NodeMatcher? = null
            val uiScope = object : RecordingTaskUiScope() {
                override suspend fun getTextWithinContainer(
                    matcher: NodeMatcher,
                    containerMatcher: NodeMatcher,
                    retry: TaskRetry,
                    strict: Boolean,
                ): String {
                    capturedContainer = containerMatcher
                    throw IllegalStateException(
                        "No UI node found matching criteria: $matcher within container: $containerMatcher",
                    )
                }
            }
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val expectedContainer = NodeMatcher(resourceId = "com.example:id/list")

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.ReadText(
                                id = "rt-container-no-target",
                                matcher = NodeMatcher(textEquals = "Missing"),
                                container = expectedContainer,
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("read_text", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("NODE_NOT_FOUND", stepResult.data["error"])
            assertEquals(expectedContainer, capturedContainer)
        }

    @Test
    fun `execute read_text with all and container not found fails`() =
        actionTest {
            var capturedContainer: NodeMatcher? = null
            val uiScope = object : RecordingTaskUiScope() {
                override suspend fun getAllTextWithinContainer(
                    matcher: NodeMatcher,
                    containerMatcher: NodeMatcher,
                    retry: TaskRetry,
                    strict: Boolean,
                ): List<String> {
                    capturedContainer = containerMatcher
                    throw IllegalStateException("Container not found for: $containerMatcher")
                }
            }
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val expectedContainer = NodeMatcher(resourceId = "com.example:id/nonexistent")

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.ReadText(
                                id = "rt-all-container-missing",
                                matcher = NodeMatcher(role = "text"),
                                all = true,
                                container = expectedContainer,
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("read_text", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("CONTAINER_NOT_FOUND", stepResult.data["error"])
            assertEquals(expectedContainer, capturedContainer)
        }

    @Test
    fun `execute read_text with all and container succeeds`() =
        actionTest {
            var capturedMatcher: NodeMatcher? = null
            var capturedContainer: NodeMatcher? = null
            val uiScope = object : RecordingTaskUiScope() {
                override suspend fun getAllTextWithinContainer(
                    matcher: NodeMatcher,
                    containerMatcher: NodeMatcher,
                    retry: TaskRetry,
                    strict: Boolean,
                ): List<String> {
                    capturedMatcher = matcher
                    capturedContainer = containerMatcher
                    return listOf("Item 1", "Item 2", "Item 3")
                }
            }
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val expectedMatcher = NodeMatcher(role = "text")
            val expectedContainer = NodeMatcher(resourceId = "com.example:id/list")

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.ReadText(
                                id = "rt-all-container",
                                matcher = expectedMatcher,
                                all = true,
                                container = expectedContainer,
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("read_text", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("true", stepResult.data["all"])
            assertEquals("3", stepResult.data["count"])
            assertEquals("[\"Item 1\",\"Item 2\",\"Item 3\"]", stepResult.data["text"])
            assertEquals(expectedMatcher, capturedMatcher)
            assertEquals(expectedContainer, capturedContainer)
            assertTrue(stepResult.data.containsKey("container"))
            assertFalse(stepResult.data["container"].isNullOrBlank())
        }

    @Test
    fun `execute read_text with container and validator succeeds`() =
        actionTest {
            val uiScope = object : RecordingTaskUiScope() {
                override suspend fun getValidatedTextWithinContainer(
                    matcher: NodeMatcher,
                    containerMatcher: NodeMatcher,
                    retry: TaskRetry,
                    strict: Boolean,
                    validator: (String) -> Boolean,
                ): String {
                    val value = "20.5°C"
                    if (!validator(value)) {
                        throw IllegalStateException("Validation failed for text '$value'")
                    }
                    return value
                }
            }
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.ReadText(
                                id = "rt-container-validator",
                                matcher = NodeMatcher(textContains = "Temp"),
                                container = NodeMatcher(resourceId = "com.example:id/list"),
                                validator = UiTextValidator.Temperature,
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("read_text", stepResult.actionType)
            assertEquals(true, stepResult.success)
            assertEquals("20.5°C", stepResult.data["text"])
            assertEquals("temperature", stepResult.data["validator"])
        }

    @Test
    fun `execute read_text with container and validator fails`() =
        actionTest {
            val uiScope = object : RecordingTaskUiScope() {
                override suspend fun getValidatedTextWithinContainer(
                    matcher: NodeMatcher,
                    containerMatcher: NodeMatcher,
                    retry: TaskRetry,
                    strict: Boolean,
                    validator: (String) -> Boolean,
                ): String {
                    val value = "not a temperature"
                    if (!validator(value)) {
                        throw IllegalStateException("Validation failed for text '$value' from matching UI node within container")
                    }
                    return value
                }
            }
            val taskScope = RecordingTaskScope(uiScope)
            val engine = UiActionEngineDefault(DeveloperOptionsManagerMock(), UiGlobalActionDispatcherMock())

            val result =
                engine.execute(
                    taskScope = taskScope,
                    plan = UiActionPlan(
                        commandId = "cmd",
                        taskId = "task",
                        source = "test",
                        actions = listOf(
                            UiAction.ReadText(
                                id = "rt-container-validator-fail",
                                matcher = NodeMatcher(textContains = "Temp"),
                                container = NodeMatcher(resourceId = "com.example:id/list"),
                                validator = UiTextValidator.Temperature,
                            ),
                        ),
                    ),
                )

            val stepResult = result.stepResults.single()
            assertEquals("read_text", stepResult.actionType)
            assertEquals(false, stepResult.success)
            assertEquals("VALIDATOR_MISMATCH", stepResult.data["error"])
            assertEquals("not a temperature", stepResult.data["raw_text"])
        }

    @Test
    fun `toast steps await submission and preserve correlation without claiming visibility`() =
        actionTest {
            val calls = mutableListOf<String>()
            val controller = object : ApiToastController {
                override suspend fun show(text: String, duration: String) {
                    kotlinx.coroutines.delay(1)
                    calls += "$text:$duration"
                }
                override suspend fun cancel() {
                    kotlinx.coroutines.delay(1)
                    calls += "cancel"
                }
            }
            val engine = UiActionEngineDefault(
                developerOptionsManager = DeveloperOptionsManagerMock(),
                globalActionDispatcher = UiGlobalActionDispatcherMock(),
                deviceState = DeviceStateMock(),
                apiToastController = controller,
            )
            val result = engine.execute(TaskScopeNoOp(), UiActionPlan(
                commandId = "toast-command", taskId = "toast-task", source = "test",
                actions = listOf(UiAction.ShowToast("show", "Private message", "long"), UiAction.CancelToast("cancel")),
            ))
            assertEquals(listOf("Private message:long", "cancel"), calls)
            assertEquals("toast-command", result.commandId)
            assertEquals("toast-task", result.taskId)
            assertEquals(listOf("show", "cancel"), result.stepResults.map { it.id })
            assertTrue(result.stepResults.all { it.success })
            assertEquals(mapOf("submitted" to "true", "duration" to "long"), result.stepResults[0].data)
            assertEquals(mapOf("submitted" to "true"), result.stepResults[1].data)
        }

    @Test
    fun `failed toast submission produces a failed step and stops the sequence`() =
        actionTest {
            val controller = object : ApiToastController {
                override suspend fun show(text: String, duration: String) { error("Submission failed") }
                override suspend fun cancel() { error("Must not execute after failure") }
            }
            val engine = UiActionEngineDefault(
                developerOptionsManager = DeveloperOptionsManagerMock(),
                globalActionDispatcher = UiGlobalActionDispatcherMock(),
                deviceState = DeviceStateMock(),
                apiToastController = controller,
            )
            val result = engine.execute(TaskScopeNoOp(), UiActionPlan(
                commandId = "toast-command", taskId = "toast-task", source = "test",
                actions = listOf(UiAction.ShowToast("show", "text"), UiAction.CancelToast("cancel")),
            ))
            val step = result.stepResults.single()
            assertFalse(step.success)
            assertEquals("show_toast", step.actionType)
            assertEquals("ACTION_FAILED", step.data["errorCode"])
            assertFalse(step.data.containsKey("submitted"))
        }

    @Test
    fun `execute set_on_screen_log returns acknowledged result data without text`() =
        actionTest {
            val normalized =
                NormalizedOnScreenLogSpec(
                    text = "Sensitive caller label",
                    anchor = OnScreenLogAnchor.Right,
                    textAlign = OnScreenLogTextAlign.Left,
                    topOffsetDp = 0,
                    edgeOffsetDp = 12,
                    widthDp = 320,
                    fontSizeSp = 16,
                    textColor = "#FFA1B2C3",
                    backgroundColor = "#7F0A0B0C",
                    ttlMs = 12_000L,
                )
            val controller =
                OnScreenLogControllerFake(
                    setResult =
                        OnScreenLogControllerResult.Rendered(
                            spec = normalized,
                            bounds = OnScreenLogBounds(left = 700, top = 16, right = 1020, bottom = 82),
                            truncated = false,
                        ),
                )
            val engine =
                UiActionEngineDefault(
                    developerOptionsManager = DeveloperOptionsManagerMock(),
                    globalActionDispatcher = UiGlobalActionDispatcherMock(),
                    deviceState = DeviceStateMock(),
                    onScreenLogController = controller,
                )

            val result =
                engine.execute(
                    taskScope = TaskScopeNoOp(),
                    plan =
                        UiActionPlan(
                            commandId = "on-screen-log-set",
                            taskId = "on-screen-log-task",
                            source = "test",
                            actions = listOf(UiAction.SetOnScreenLog(id = "set", spec = OnScreenLogSpec(text = "caller input"))),
                        ),
                )

            val step = result.stepResults.single()
            assertTrue(step.success)
            assertEquals("set_on_screen_log", step.actionType)
            assertEquals(
                mapOf(
                    "visible" to "true",
                    "rendered" to "true",
                    "truncated" to "false",
                    "anchor" to "right",
                    "text_align" to "left",
                    "top_offset_dp" to "0",
                    "edge_offset_dp" to "12",
                    "width_dp" to "320",
                    "font_size_sp" to "16",
                    "text_color" to "#FFA1B2C3",
                    "background_color" to "#7F0A0B0C",
                    "ttl_ms" to "12000",
                    "bounds" to "[700,16][1020,82]",
                ),
                step.data,
            )
            assertFalse(step.data.containsKey("text"))
            assertEquals("caller input", controller.setSpecs.single().text)
        }

    @Test
    fun `execute set_on_screen_log maps every structured controller failure`() =
        actionTest {
            for (errorCode in listOf(
                OnScreenLogErrorCodes.SERVICE_UNAVAILABLE,
                OnScreenLogErrorCodes.LAYOUT_INVALID,
                OnScreenLogErrorCodes.RENDER_FAILED,
                OnScreenLogErrorCodes.RENDER_TIMEOUT,
            )) {
                val engine =
                    UiActionEngineDefault(
                        developerOptionsManager = DeveloperOptionsManagerMock(),
                        globalActionDispatcher = UiGlobalActionDispatcherMock(),
                        deviceState = DeviceStateMock(),
                        onScreenLogController =
                            OnScreenLogControllerFake(
                                setResult = OnScreenLogControllerResult.Failure(errorCode, "failure for $errorCode"),
                            ),
                    )

                val result =
                    engine.execute(
                        taskScope = TaskScopeNoOp(),
                        plan =
                            UiActionPlan(
                                commandId = "on-screen-log-failure",
                                taskId = "on-screen-log-task",
                                source = "test",
                                actions = listOf(UiAction.SetOnScreenLog(id = "set", spec = OnScreenLogSpec(text = "label"))),
                            ),
                    )

                val step = result.stepResults.single()
                assertFalse(step.success)
                assertEquals(errorCode, step.data["error"])
                assertEquals("failure for $errorCode", step.data["message"])
            }
        }

    @Test
    fun `execute clear_on_screen_log reports hidden without a rendered field`() =
        actionTest {
            val engine =
                UiActionEngineDefault(
                    developerOptionsManager = DeveloperOptionsManagerMock(),
                    globalActionDispatcher = UiGlobalActionDispatcherMock(),
                    deviceState = DeviceStateMock(),
                    onScreenLogController = OnScreenLogControllerFake(clearResult = OnScreenLogControllerResult.Cleared),
                )

            val result =
                engine.execute(
                    taskScope = TaskScopeNoOp(),
                    plan =
                        UiActionPlan(
                            commandId = "on-screen-log-clear",
                            taskId = "on-screen-log-task",
                            source = "test",
                            actions = listOf(UiAction.ClearOnScreenLog(id = "clear")),
                        ),
                )

            val step = result.stepResults.single()
            assertTrue(step.success)
            assertEquals("clear_on_screen_log", step.actionType)
            assertEquals(mapOf("visible" to "false"), step.data)
            assertFalse(step.data.containsKey("rendered"))
        }
}

private class RecordingTaskScope(
    private val uiScope: RecordingTaskUiScope,
    private val snapshotResult: UiSnapshotResult = UiSnapshotResult(actualFormat = UiSnapshotActualFormat.HierarchyXml),
) : TaskScope {
    val openedApps = mutableListOf<String>()
    var logUiTreeCount: Int = 0
    var waitForNavigationCallCount: Int = 0
    var waitForNavigationCalledAfterOpenApp: Boolean = false
    var lastWaitForNavigationAllowAlreadyForeground: Boolean = false

    override suspend fun openApp(
        applicationId: String,
        retry: TaskRetry,
    ) {
        openedApps += applicationId
    }

    override suspend fun openUri(
        uri: String,
        retry: TaskRetry,
    ) {
    }

    override suspend fun pause(
        duration: Duration,
        retry: TaskRetry,
    ) {
    }

    override suspend fun logUiTree(
        retry: TaskRetry,
    ): UiSnapshotResult {
        logUiTreeCount++
        return snapshotResult
    }

    override suspend fun closeApp(
        applicationId: String,
        retry: TaskRetry,
    ) {
    }

    var waitForNavigationResult = WaitForNavigationResult(success = true, lastPackage = "com.example", elapsedMs = 100)

    override suspend fun waitForNavigation(
        expectedPackage: String?,
        expectedNode: NodeMatcher?,
        timeoutMs: Long,
        allowAlreadyForeground: Boolean,
    ): WaitForNavigationResult {
        waitForNavigationCallCount += 1
        waitForNavigationCalledAfterOpenApp = openedApps.isNotEmpty()
        lastWaitForNavigationAllowAlreadyForeground = allowAlreadyForeground
        return waitForNavigationResult
    }

    override suspend fun <T> ui(block: suspend TaskUiScope.() -> T): T = uiScope.block()
}

open class RecordingTaskUiScope(
    private val scrollOnceOutcome: TaskScrollOutcome = TaskScrollOutcome.Moved,
    private val scrollOnceThrows: IllegalStateException? = null,
    private val scrollOnceContainerId: String? = null,
    private val scrollLoopResult: TaskScrollLoopResult = TaskScrollLoopResult(TaskScrollTerminationReason.EdgeReached, scrollsExecuted = 3),
    private val waitForNodeThrows: Exception? = null,
) : TaskUiScope {
    override suspend fun drag(start: action.math.geometry.Point, end: action.math.geometry.Point, holdDurationMs: Long, moveDurationMs: Long) { error("Unexpected drag") }

    override suspend fun swipe(start: action.math.geometry.Point, end: action.math.geometry.Point, durationMs: Long) {
        error("Swipe not configured in test")
    }

    override suspend fun queryUi(
        matcher: NodeMatcher?,
        visibility: String,
        limit: Int,
    ): String = error("Query not configured in test")

    var scrollIntoViewCalled: Boolean = false
    var scrollOnceCalled: Boolean = false
    var clickCalled: Boolean = false
    var clickCoordinate: action.math.geometry.Point? = null
    var submissionOutcome: TextSubmissionOutcome? = null
    var enteredText: String? = null
    var enterTextClear: Boolean? = null
    var enterTextSubmit: Boolean? = null
    var enterTextRetry: TaskRetry? = null

    override suspend fun getValidatedText(
        matcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
        validator: (String) -> Boolean,
    ): String {
        val value = "22.5 C"
        if (!validator(value)) {
            throw IllegalStateException("Validation failed for text '$value' from matching UI node")
        }
        return value
    }

    override suspend fun waitForNode(
        matcher: NodeMatcher,
        retry: TaskRetry,
        timeoutMs: Long?,
        strict: Boolean,
        container: NodeMatcher?,
    ): TaskUiNode {
        if (waitForNodeThrows != null) {
            throw waitForNodeThrows
        }
        return TaskUiNode(
            resourceId = "com.example:id/title",
            label = "Title Text",
            clickable = true,
            role = "text",
            bounds = Rect.Zero,
            debugPath = "0/0",
        )
    }

    override suspend fun getAllText(
        matcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
    ): List<String> = listOf("Title Text 1", "Title Text 2")

    override suspend fun getText(
        matcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
    ): String = "Title Text"

    override suspend fun getTextWithinContainer(
        matcher: NodeMatcher,
        containerMatcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
    ): String = "Title Text in Container"

    override suspend fun getAllTextWithinContainer(
        matcher: NodeMatcher,
        containerMatcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
    ): List<String> = listOf("Title Text 1 in Container", "Title Text 2 in Container")

    override suspend fun getValidatedTextWithinContainer(
        matcher: NodeMatcher,
        containerMatcher: NodeMatcher,
        retry: TaskRetry,
        strict: Boolean,
        validator: (String) -> Boolean,
    ): String {
        val value = "22.5 C"
        if (!validator(value)) {
            throw IllegalStateException("Validation failed for text '$value' from matching UI node within container")
        }
        return value
    }

    var readKeyValuePairResult: Pair<String, String> = Pair("Label", "Value")
    var readKeyValuePairThrows: IllegalStateException? = null

    override suspend fun readKeyValuePair(
        labelMatcher: NodeMatcher,
        retry: TaskRetry,
    ): Pair<String, String> {
        if (readKeyValuePairThrows != null) throw readKeyValuePairThrows!!
        return readKeyValuePairResult
    }

    override suspend fun click(
        matcher: NodeMatcher?,
        coordinate: action.math.geometry.Point?,
        clickTypes: UiTreeClickTypes,
        retry: TaskRetry,
        strict: Boolean,
        container: NodeMatcher?,
    ) {
        clickCalled = true
        clickCoordinate = coordinate
    }

    override suspend fun scrollOnce(
        container: NodeMatcher?,
        direction: TaskScrollDirection,
        distanceRatio: Float,
        settleDelay: Duration,
        retry: TaskRetry,
        findFirstScrollableChild: Boolean,
        strict: Boolean,
    ): TaskScrollOnceResult {
        scrollOnceCalled = true
        scrollOnceThrows?.let { throw it }
        return TaskScrollOnceResult(scrollOnceOutcome, scrollOnceContainerId)
    }

    override suspend fun scrollLoop(
        target: NodeMatcher?,
        container: NodeMatcher?,
        direction: TaskScrollDirection,
        distanceRatio: Float,
        settleDelay: Duration,
        maxScrolls: Int,
        maxDuration: Duration,
        noPositionChangeThreshold: Int,
        findFirstScrollableChild: Boolean,
        strict: Boolean,
    ): TaskScrollLoopResult = scrollLoopResult

    override suspend fun scrollUntil(
        target: NodeMatcher,
        container: NodeMatcher?,
        direction: TaskScrollDirection,
        maxSwipes: Int,
        distanceRatio: Float,
        settleDelay: Duration,
        retry: TaskRetry,
        findFirstScrollableChild: Boolean,
        strict: Boolean,
    ): TaskScrollResult {
        scrollIntoViewCalled = true
        return TaskScrollResult.Found(
            TaskUiNode(
                resourceId = "com.example:id/bedroom",
                label = "Bedroom",
                clickable = true,
                role = "button",
                bounds = Rect.Zero,
                debugPath = "0/1",
            ),
        )
    }

    override suspend fun scrollIntoView(
        target: NodeMatcher,
        container: NodeMatcher?,
        direction: TaskScrollDirection,
        maxSwipes: Int,
        distanceRatio: Float,
        settleDelay: Duration,
        retry: TaskRetry,
        findFirstScrollableChild: Boolean,
        strict: Boolean,
    ): TaskUiNode {
        scrollIntoViewCalled = true
        return TaskUiNode(
            resourceId = "com.example:id/bedroom",
            label = "Bedroom",
            clickable = true,
            role = "button",
            bounds = Rect.Zero,
            debugPath = "0/1",
        )
    }

    override suspend fun getCurrentToggleState(
        target: NodeMatcher,
        retry: TaskRetry,
    ): ToggleState = ToggleState.Unknown

    override suspend fun setCurrentToggleState(
        target: NodeMatcher,
        desiredState: ToggleState,
        retry: TaskRetry,
    ): ToggleState = desiredState

    override suspend fun enterText(
        matcher: NodeMatcher,
        text: String,
        submit: Boolean,
        clear: Boolean,
        retry: TaskRetry,
        strict: Boolean,
        container: NodeMatcher?,
    ): TextSubmissionOutcome {
        enteredText = text
        enterTextClear = clear
        enterTextSubmit = submit
        enterTextRetry = retry
        return submissionOutcome ?: if (submit) TextSubmissionOutcome.Unavailable else TextSubmissionOutcome.NotRequested
    }
}

private class DeveloperOptionsManagerMock : DeveloperOptionsManager {
    override val isEnabled: Flow<Boolean> = flowOf(true)
    override val isUsbDebuggingEnabled: Flow<Boolean> = flowOf(true)
}

private class DirectQueryDeviceStateFake(
    private val queryScreenOnValue: Boolean,
    eventedScreenOnValue: Boolean,
    private val queryDeviceLockedValue: Boolean,
    eventedDeviceLockedValue: Boolean,
    private val userUnlockedValue: Boolean,
) : DeviceState {
    override val queryDeviceLocked: Boolean
        get() = queryDeviceLockedValue

    override val isDeviceLocked = MutableStateFlow(eventedDeviceLockedValue)

    override val isScreenOn = MutableStateFlow(eventedScreenOnValue)

    override fun queryScreenOn(): Boolean = queryScreenOnValue

    override val isUserUnlocked: Boolean
        get() = userUnlockedValue

    override fun registerForUserUnlock(block: () -> Unit) {}

    override val isPhone: Boolean = true
}

private class UiGlobalActionDispatcherMock(
    private val result: Boolean = true,
    private val error: IllegalStateException? = null,
) : UiGlobalActionDispatcher {
    override fun perform(key: UiSystemKey): Boolean {
        error?.let { throw it }
        return result
    }
}

private class OnScreenLogControllerFake(
    var setResult: OnScreenLogControllerResult = OnScreenLogControllerResult.Cleared,
    var clearResult: OnScreenLogControllerResult = OnScreenLogControllerResult.Cleared,
) : OnScreenLogController {
    val setSpecs = mutableListOf<OnScreenLogSpec>()

    override suspend fun set(
        spec: OnScreenLogSpec,
        drawAcknowledgementTimeoutMs: Long,
    ): OnScreenLogControllerResult {
        setSpecs += spec
        return setResult
    }

    override suspend fun clear(): OnScreenLogControllerResult = clearResult
}
