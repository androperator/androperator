package androperator.task.runner

import androperator.uitree.TextSubmissionOutcome
import action.log.Log
import action.media.NotificationMediaService
import action.media.NotificationMediaException
import action.developeroptions.DeveloperOptionsManager
import action.devicestate.DeviceState
import action.devicestate.DeviceStateMock
import androperator.uitree.UiTreeClickType
import androperator.uitree.UiTreeClickTypes
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.first
import kotlin.time.Duration.Companion.milliseconds

interface UiActionEngine {
    suspend fun execute(
        taskScope: TaskScope,
        plan: UiActionPlan,
    ): UiActionExecutionResult
}

class UiActionEngineDefault(
    private val developerOptionsManager: DeveloperOptionsManager,
    private val globalActionDispatcher: UiGlobalActionDispatcher,
    private val deviceState: DeviceState,
    private val recordingManager: RecordingManager = RecordingManagerNoOp,
    private val onScreenLogController: OnScreenLogController = OnScreenLogControllerNoOp,
    private val notificationMediaService: NotificationMediaService? = null,
    private val apiToastController: ApiToastController? = null,
) : UiActionEngine {
    constructor(
        developerOptionsManager: DeveloperOptionsManager,
        globalActionDispatcher: UiGlobalActionDispatcher,
        recordingManager: RecordingManager = RecordingManagerNoOp,
    ) : this(
        developerOptionsManager = developerOptionsManager,
        globalActionDispatcher = globalActionDispatcher,
        deviceState = DeviceStateMock(),
        recordingManager = recordingManager,
    )

    companion object {
        private const val TAG = "[UiActionEngine]"
    }

    override suspend fun execute(
        taskScope: TaskScope,
        plan: UiActionPlan,
    ): UiActionExecutionResult =
        withContext(TaskStatusElement(currentTaskStatus(), plan.commandId)) {
            val stepResults = kotlin.coroutines.coroutineContext[ActionExecutionJournal]?.steps
                ?: mutableListOf<UiActionStepResult>()

            for (action in plan.actions) {
                val warnings = SelectionWarnings()
                val receipt = ActionReceipt()
                var serviceDispatched = false
                val isMediaControl = action is UiAction.NotificationMedia && action.type in setOf("media_play", "media_pause", "media_seek", "dismiss_notification", "invoke_notification_action")
                val recordsDispatch = action is UiAction.Drag || action is UiAction.Swipe || action is UiAction.Click || action is UiAction.EnterText ||
                    action is UiAction.Scroll || action is UiAction.ScrollUntil || action is UiAction.ScrollAndClick
                fun evidence() = warnings.stepData() +
                    (if (recordsDispatch) receipt.stepData() else emptyMap()) +
                    (if (isMediaControl && action is UiAction.NotificationMedia) mapOf("dispatched" to serviceDispatched.toString(), "waitTimeoutMs" to action.waitTimeoutMs.toString()) +
                        (if (action.type == "media_seek") mapOf("requestedPositionMs" to action.positionMs.toString(), "positionToleranceMs" to action.positionToleranceMs.toString()) else emptyMap()) else emptyMap())
                val stepResult = try {
                    val result = withContext(warnings + receipt + receipt.observation) { executeSingle(taskScope, action) { serviceDispatched = true } }
                    val failureCode = if (!result.success && !result.data.containsKey("errorCode")) {
                        // Returned failures already use data.error as a machine-readable code.
                        mapOf("errorCode" to (result.data["error"] ?: "ACTION_FAILED"))
                    } else {
                        emptyMap()
                    }
                    result.copy(data = result.data + failureCode + evidence())
                } catch (error: Exception) {
                    val code = when (error) {
                        is StrictSelectionException -> error.code
                        is QueryHierarchyUnavailableException -> error.code
                        is UiActionFailure -> error.code
                        is kotlinx.coroutines.TimeoutCancellationException -> "COMMAND_TIMEOUT"
                        is kotlinx.coroutines.CancellationException -> "COMMAND_CANCELLED"
                        else -> "ACTION_FAILED"
                    }
                    val details = when (error) {
                        is StrictSelectionException -> error.stepData()
                        is QueryHierarchyUnavailableException -> error.stepData()
                        else -> emptyMap()
                    }
                    stepResults += UiActionStepResult(action.id, action.wireType(), success = false,
                        data = evidence() + details + mapOf("errorCode" to code, "error" to error.message.orEmpty()))
                    if (error is kotlinx.coroutines.CancellationException) throw error
                    return@withContext UiActionExecutionResult(plan.commandId, plan.taskId, stepResults.toList(), code, error.message)
                }
                stepResults += stepResult
            }

            UiActionExecutionResult(
                commandId = plan.commandId,
                taskId = plan.taskId,
                stepResults = stepResults,
            )
        }

    private suspend fun executeSingle(
        taskScope: TaskScope,
        action: UiAction,
        onServiceDispatch: () -> Unit = {},
    ): UiActionStepResult {
        Log.d(
            "$TAG step_start id=${action.id} type=${action::class.simpleName}",
        )

        val result =
            when (action) {
                is UiAction.NotificationMedia -> {
                    try {
                        val service = notificationMediaService ?: throw NotificationMediaException("NOTIFICATION_SERVICE_UNAVAILABLE", "Service is unavailable")
                        UiActionStepResult(action.id, action.type, data = mapOf("payload" to service.execute(action.type, action.applicationId, action.mediaSessionId, action.limit, action.maxTextChars, action.waitTimeoutMs, onServiceDispatch, action.notificationKey, action.actionId, action.positionMs, action.positionToleranceMs, action.durationMs)))
                    } catch (error: NotificationMediaException) {
                        UiActionStepResult(action.id, action.type, success = false, data = mapOf("errorCode" to error.code, "error" to error.message.orEmpty(), "dispatched" to error.dispatched.toString(), "waitTimeoutMs" to action.waitTimeoutMs.toString()))
                    }
                }

                is UiAction.OpenUri -> executeOpenUri(taskScope, action)
                is UiAction.OpenApp -> executeOpenApp(taskScope, action)
                is UiAction.CloseApp -> executeCloseApp(taskScope, action)
                is UiAction.WaitForNode -> executeWaitForNode(taskScope, action)
                is UiAction.Drag -> {
                    taskScope.ui { drag(action.start, action.end, action.holdDurationMs, action.moveDurationMs) }
                    UiActionStepResult(action.id, "drag", data = mapOf(
                        "start" to "{\"x\":${action.start.x},\"y\":${action.start.y}}",
                        "end" to "{\"x\":${action.end.x},\"y\":${action.end.y}}",
                        "hold_duration_ms" to action.holdDurationMs.toString(),
                        "move_duration_ms" to action.moveDurationMs.toString(),
                    ))
                }
                is UiAction.Swipe -> {
                    taskScope.ui { swipe(action.start, action.end, action.durationMs) }
                    UiActionStepResult(action.id, "swipe", data = mapOf(
                        "start" to "{\"x\":${action.start.x},\"y\":${action.start.y}}",
                        "end" to "{\"x\":${action.end.x},\"y\":${action.end.y}}",
                        "duration_ms" to action.durationMs.toString(),
                    ))
                }
                is UiAction.Click -> executeClick(taskScope, action)
                is UiAction.ScrollAndClick -> executeScrollAndClick(taskScope, action)
                is UiAction.Scroll -> executeScroll(taskScope, action)
                is UiAction.ScrollUntil -> executeScrollUntil(taskScope, action)
                is UiAction.ReadText -> executeReadText(taskScope, action)
                is UiAction.QueryUi -> executeQueryUi(taskScope, action)
                is UiAction.SnapshotUi -> executeSnapshotUi(taskScope, action)
                is UiAction.ShowToast -> executeShowToast(action)
                is UiAction.CancelToast -> executeCancelToast(action)
                is UiAction.SetOnScreenLog -> executeSetOnScreenLog(action)
                is UiAction.ClearOnScreenLog -> executeClearOnScreenLog(action)
                is UiAction.StartRecording -> executeStartRecording(action)
                is UiAction.StopRecording -> executeStopRecording(action)
                is UiAction.TakeScreenshot -> executeTakeScreenshot(taskScope, action)
                is UiAction.EnterText -> executeEnterText(taskScope, action)
                is UiAction.Sleep -> executeSleep(taskScope, action)
                is UiAction.DoctorPing -> executeDoctorPing(taskScope, action)
                is UiAction.PressKey -> executePressKey(action)
                is UiAction.WaitForNavigation -> executeWaitForNavigation(taskScope, action)
                is UiAction.ReadKeyValuePair -> executeReadKeyValuePair(taskScope, action)
            }

        Log.d(
            "$TAG step_success id=${action.id} type=${action::class.simpleName} success=${result.success}",
        )
        return result
    }

    private suspend fun executeOpenUri(
        taskScope: TaskScope,
        action: UiAction.OpenUri,
    ): UiActionStepResult {
        taskScope.openUri(action.uri, action.retry)
        return UiActionStepResult(
            id = action.id,
            actionType = "open_uri",
            data = mapOf("uri" to action.uri),
        )
    }

    private suspend fun executeOpenApp(
        taskScope: TaskScope,
        action: UiAction.OpenApp,
    ): UiActionStepResult {
        taskScope.openApp(action.applicationId, action.retry)
        if (action.skipNavigationWait) {
            return UiActionStepResult(
                id = action.id,
                actionType = "open_app",
                data = mapOf(
                    "application_id" to action.applicationId,
                ),
            )
        }

        val navigationResult = taskScope.waitForNavigation(
            expectedPackage = action.applicationId,
            expectedNode = null,
            timeoutMs = action.navigationTimeoutMs,
            allowAlreadyForeground = true,
        )

        if (!navigationResult.success) {
            return UiActionStepResult(
                id = action.id,
                actionType = "open_app",
                success = false,
                data = buildMap {
                    put("application_id", action.applicationId)
                    put("error", "NAVIGATION_TIMEOUT")
                    navigationResult.lastPackage?.let { put("last_package", it) }
                    put("navigation_elapsed_ms", navigationResult.elapsedMs.toString())
                    put(
                        "message",
                        "Timed out waiting for ${action.applicationId} to reach the foreground package",
                    )
                },
            )
        }

        return UiActionStepResult(
            id = action.id,
            actionType = "open_app",
            data = buildMap {
                put("application_id", action.applicationId)
                put("navigation_elapsed_ms", navigationResult.elapsedMs.toString())
                navigationResult.lastPackage?.let { put("resolved_package", it) }
            },
        )
    }

    private suspend fun executeCloseApp(
        taskScope: TaskScope,
        action: UiAction.CloseApp,
    ): UiActionStepResult {
        // The Android runtime cannot reliably force-stop other apps due to sandbox restrictions.
        // We return an error here to signal that the 'Hand' (Node CLI) should have handled this via ADB.
        return UiActionStepResult(
            id = action.id,
            actionType = "close_app",
            success = false,
            data = mapOf(
                "application_id" to action.applicationId,
                "error" to "UNSUPPORTED_RUNTIME_CLOSE",
                "message" to "Android runtime cannot reliably close apps. Use the Androperator Node API or 'adb shell am force-stop' directly for this action."
            ),
        )
    }

    private suspend fun executeWaitForNavigation(
        taskScope: TaskScope,
        action: UiAction.WaitForNavigation,
    ): UiActionStepResult {
        val result = taskScope.waitForNavigation(
            expectedPackage = action.expectedPackage,
            expectedNode = action.expectedNode,
            timeoutMs = action.timeoutMs,
        )

        return if (result.success) {
            UiActionStepResult(
                id = action.id,
                actionType = "wait_for_navigation",
                data = buildMap {
                    result.lastPackage?.let { put("resolved_package", it) }
                    put("elapsed_ms", result.elapsedMs.toString())
                },
            )
        } else {
            UiActionStepResult(
                id = action.id,
                actionType = "wait_for_navigation",
                success = false,
                data = buildMap {
                    put("error", "NAVIGATION_TIMEOUT")
                    result.lastPackage?.let { put("last_package", it) }
                },
            )
        }
    }

    private suspend fun executeReadKeyValuePair(
        taskScope: TaskScope,
        action: UiAction.ReadKeyValuePair,
    ): UiActionStepResult {
        return try {
            val (label, value) = taskScope.ui {
                readKeyValuePair(action.labelMatcher, action.retry)
            }
            UiActionStepResult(
                id = action.id,
                actionType = "read_key_value_pair",
                data = mapOf(
                    "label" to label,
                    "value" to value,
                ),
            )
        } catch (e: IllegalStateException) {
            val errorCode = when (e.message) {
                "NODE_NOT_FOUND" -> "NODE_NOT_FOUND"
                "VALUE_NODE_NOT_FOUND" -> "VALUE_NODE_NOT_FOUND"
                else -> throw e
            }
            UiActionStepResult(
                id = action.id,
                actionType = "read_key_value_pair",
                success = false,
                data = mapOf("error" to errorCode),
            )
        }
    }

    private suspend fun executeWaitForNode(
        taskScope: TaskScope,
        action: UiAction.WaitForNode,
    ): UiActionStepResult {
        val node =
            taskScope.ui {
                waitForNode(action.matcher, action.retry, action.timeoutMs, action.strict, action.container)
            }

        return UiActionStepResult(
            id = action.id,
            actionType = "wait_for_node",
            data =
                buildMap {
                    put("resource_id", node.resourceId ?: "")
                    put("label", node.label)
                    action.timeoutMs?.let { put("timeout_ms", it.toString()) }
                },
        )
    }

    private suspend fun executeClick(
        taskScope: TaskScope,
        action: UiAction.Click,
    ): UiActionStepResult {
        taskScope.ui {
            click(
                matcher = action.matcher,
                coordinate = action.coordinate,
                clickTypes = action.clickTypes,
                retry = action.retry,
                strict = action.strict,
                container = action.container,
            )
        }
        return UiActionStepResult(
            id = action.id,
            actionType = "click",
            data =
                buildMap {
                    action.coordinate?.let { put("coordinate", it.shortString) }
                    put("click_types", action.clickTypes.toWireValue())
                },
        )
    }

    private suspend fun executeScrollAndClick(
        taskScope: TaskScope,
        action: UiAction.ScrollAndClick,
    ): UiActionStepResult {
        taskScope.ui {
            clickAfterScroll(
                target = action.matcher,
                container = action.container,
                clickTypes = action.clickTypes,
                direction = action.direction,
                maxSwipes = action.maxSwipes,
                distanceRatio = action.distanceRatio,
                settleDelay = action.settleDelayMs.milliseconds,
                scrollRetry = action.scrollRetry,
                clickRetry = action.clickRetry,
                findFirstScrollableChild = action.findFirstScrollableChild,
                strict = action.strict,
                clickAfter = action.clickAfter,
            )
        }

        return UiActionStepResult(
            id = action.id,
            actionType = "scroll_and_click",
            data =
                mapOf(
                    "max_swipes" to action.maxSwipes.toString(),
                    "direction" to action.direction.toString(),
                    "click_types" to action.clickTypes.toWireValue(),
                    "click_after" to action.clickAfter.toString(),
                ),
        )
    }

    private suspend fun executeScroll(
        taskScope: TaskScope,
        action: UiAction.Scroll,
    ): UiActionStepResult {
        return try {
            val result =
                taskScope.ui {
                    scrollOnce(
                        container = action.container,
                        direction = action.direction,
                        distanceRatio = action.distanceRatio,
                        settleDelay = action.settleDelayMs.milliseconds,
                        retry = action.retry,
                        strict = action.strict,
                        findFirstScrollableChild = action.findFirstScrollableChild,
                    )
                }
            val baseData = buildMap<String, String> {
                put("scroll_outcome", result.outcome.toWireValue())
                put("direction", action.direction.name.lowercase())
                put("distance_ratio", action.distanceRatio.toString())
                put("settle_delay_ms", action.settleDelayMs.toString())
                result.resolvedContainerId?.let { put("resolved_container", it) }
                result.progress?.let { put("progress", it) }
            }
            when (result.outcome) {
                TaskScrollOutcome.Moved, TaskScrollOutcome.EdgeReached, TaskScrollOutcome.NoMovement, TaskScrollOutcome.Unknown ->
                    UiActionStepResult(
                        id = action.id,
                        actionType = "scroll",
                        success = true,
                        data = baseData,
                    )
                TaskScrollOutcome.GestureFailed, TaskScrollOutcome.ContainerLost ->
                    UiActionStepResult(
                        id = action.id,
                        actionType = "scroll",
                        success = false,
                        data = baseData + mapOf("error" to if (result.outcome == TaskScrollOutcome.ContainerLost) "CONTAINER_LOST" else "GESTURE_FAILED"),
                    )
            }
        } catch (e: UiActionFailure) {
            if (e.code !in setOf("CONTAINER_NOT_FOUND", "CONTAINER_NOT_SCROLLABLE")) throw e
            UiActionStepResult(action.id, "scroll", success = false,
                data = mapOf("error" to e.code, "errorCode" to e.code, "message" to e.message.orEmpty(),
                    "direction" to action.direction.name.lowercase(), "settle_delay_ms" to action.settleDelayMs.toString()))
        }
    }

    private suspend fun executeScrollUntil(
        taskScope: TaskScope,
        action: UiAction.ScrollUntil,
    ): UiActionStepResult {
        val result =
            taskScope.ui {
                scrollLoop(
                    target = action.matcher,
                    container = action.container,
                    direction = action.direction,
                    distanceRatio = action.distanceRatio,
                    settleDelay = action.settleDelayMs.milliseconds,
                    maxScrolls = action.maxScrolls,
                    maxDuration = action.maxDurationMs.milliseconds,
                    noPositionChangeThreshold = action.noPositionChangeThreshold,
                    findFirstScrollableChild = action.findFirstScrollableChild,
                    strict = action.strict,
                )
            }

        val containerError = result.terminationReason == TaskScrollTerminationReason.ContainerNotFound ||
            result.terminationReason == TaskScrollTerminationReason.ContainerNotScrollable ||
            result.terminationReason == TaskScrollTerminationReason.ContainerLost

        // When a matcher was provided, only TARGET_FOUND counts as success; other terminal reasons
        // mean the requested node never became visible (probing scrolls without a matcher stay success).
        val targetNotFound =
            action.matcher != null &&
                result.terminationReason != TaskScrollTerminationReason.TargetFound

        val isError = containerError || targetNotFound

        if (!containerError &&
            !targetNotFound &&
            action.clickAfter &&
            result.terminationReason == TaskScrollTerminationReason.TargetFound &&
            action.matcher != null
        ) {
            taskScope.ui {
                clickScrollTarget(
                    target = action.matcher,
                    findFirstScrollableChild = action.findFirstScrollableChild,
                    clickTypes = action.clickTypes,
                    retry = TaskRetryPresets.UiReadiness,
                    strict = action.strict,
                    container = action.container,
                    scope = result.scope,
                )
            }
        }

        val data = buildMap<String, String> {
            put("termination_reason", result.terminationReason.toWireValue())
            put("scrolls_executed", result.scrollsExecuted.toString())
            put("direction", action.direction.name.lowercase())
            put("click_after", action.clickAfter.toString())
            put("click_types", action.clickTypes.toWireValue())
            result.resolvedContainerId?.let { put("resolved_container", it) }
            when {
                containerError -> put("error", result.terminationReason.toWireValue())
                targetNotFound -> put("error", "TARGET_NOT_FOUND")
            }
        }

        return UiActionStepResult(
            id = action.id,
            actionType = "scroll_until",
            success = !isError,
            data = data,
        )
    }

    private suspend fun executeReadText(
        taskScope: TaskScope,
        action: UiAction.ReadText,
    ): UiActionStepResult {
        return try {
            val container = action.container
            if (action.all) {
                // Multi-match mode: get all matching nodes' text
                val texts =
                    if (container != null) {
                        taskScope.ui {
                            getAllTextWithinContainer(
                                matcher = action.matcher,
                                containerMatcher = container,
                                retry = action.retry,
                                strict = action.strict,
                            )
                        }
                    } else {
                        taskScope.ui {
                            getAllText(matcher = action.matcher, retry = action.retry, strict = action.strict)
                        }
                    }

                // Return as JSON array string
                val jsonArray = texts.joinToString(
                    prefix = "[",
                    postfix = "]",
                    separator = ",",
                ) { "\"${it.replace("\\", "\\\\").replace("\"", "\\\"")}\"" }

                UiActionStepResult(
                    id = action.id,
                    actionType = "read_text",
                    data =
                        mapOf(
                            "text" to jsonArray,
                            "all" to "true",
                            "count" to texts.size.toString(),
                            "validator" to "none",
                        ) + if (container != null) mapOf("container" to container.toString()) else emptyMap(),
                )
            } else {
                // Single-match mode
                val text =
                    if (container != null) {
                        // Container-scoped read with validator support
                        taskScope.ui {
                            when (action.validator) {
                                null -> getTextWithinContainer(
                                    matcher = action.matcher,
                                    containerMatcher = container,
                                    retry = action.retry,
                                    strict = action.strict,
                                )
                                UiTextValidator.Temperature ->
                                    getValidatedTextWithinContainer(
                                        matcher = action.matcher,
                                        containerMatcher = container,
                                        retry = action.retry,
                                        strict = action.strict,
                                        validator = TaskValidators.TemperatureValidator,
                                    )
                                UiTextValidator.Version ->
                                    getValidatedTextWithinContainer(
                                        matcher = action.matcher,
                                        containerMatcher = container,
                                        retry = action.retry,
                                        strict = action.strict,
                                        validator = TaskValidators.VersionValidator,
                                    )
                                UiTextValidator.Regex -> {
                                    val regex = Regex(checkNotNull(action.validatorPattern) { "validatorPattern required for Regex validator" })
                                    getValidatedTextWithinContainer(
                                        matcher = action.matcher,
                                        containerMatcher = container,
                                        retry = action.retry,
                                        strict = action.strict,
                                        validator = { it.matches(regex) },
                                    )
                                }
                            }
                        }
                    } else {
                        // Non-container read (original behavior with validator support)
                        taskScope.ui {
                            when (action.validator) {
                                null -> getText(matcher = action.matcher, retry = action.retry, strict = action.strict)
                                UiTextValidator.Temperature ->
                                    getValidatedText(
                                        matcher = action.matcher,
                                        retry = action.retry,
                                        strict = action.strict,
                                        validator = TaskValidators.TemperatureValidator,
                                    )
                                UiTextValidator.Version ->
                                    getValidatedText(
                                        matcher = action.matcher,
                                        retry = action.retry,
                                        strict = action.strict,
                                        validator = TaskValidators.VersionValidator,
                                    )
                                UiTextValidator.Regex -> {
                                    val regex = Regex(checkNotNull(action.validatorPattern) { "validatorPattern required for Regex validator" })
                                    getValidatedText(
                                        matcher = action.matcher,
                                        retry = action.retry,
                                        strict = action.strict,
                                        validator = { it.matches(regex) },
                                    )
                                }
                            }
                        }
                    }

                UiActionStepResult(
                    id = action.id,
                    actionType = "read_text",
                    data =
                        mapOf(
                            "text" to text,
                            "validator" to (action.validator?.name?.lowercase() ?: "none"),
                        ) + if (container != null) mapOf("container" to container.toString()) else emptyMap(),
                )
            }
        } catch (e: IllegalStateException) {
            if (e is UiActionFailure && action.container != null && e.code in setOf("CONTAINER_NOT_FOUND", "NODE_NOT_FOUND")) {
                return UiActionStepResult(action.id, "read_text", success = false,
                    data = mapOf("error" to e.code, "errorCode" to e.code, "message" to e.message.orEmpty()))
            }
            if (e is StrictSelectionException || e is UiActionFailure || e is QueryHierarchyUnavailableException) throw e
            val msg = e.message ?: ""
            // All validators should return VALIDATOR_MISMATCH on validation failure.
            // NOTE: This extraction depends on the exact message format from getValidatedText.
            // If that message changes, rawText extraction will silently fail (empty string).
            // Consider throwing a typed wrapper exception from getValidatedText to decouple.
            if (msg.contains("Validation failed for text") && action.validator != null) {
                val match = Regex("Validation failed for text '(.*)' from").find(msg)
                val rawText = match?.groupValues?.get(1) ?: ""
                return UiActionStepResult(
                    id = action.id,
                    actionType = "read_text",
                    success = false,
                    data = mapOf(
                        "error" to "VALIDATOR_MISMATCH",
                        "raw_text" to rawText,
                    ),
                )
            }
            // Check for container-related errors
            if (msg.contains("Container not found")) {
                return UiActionStepResult(
                    id = action.id,
                    actionType = "read_text",
                    success = false,
                    data = mapOf("error" to "CONTAINER_NOT_FOUND"),
                )
            }
            // Container matched but the target matcher hit nothing inside its subtree
            if (msg.contains("No UI node found matching criteria") && msg.contains("within container")) {
                return UiActionStepResult(
                    id = action.id,
                    actionType = "read_text",
                    success = false,
                    data = mapOf("error" to "NODE_NOT_FOUND"),
                )
            }
            throw e
        } catch (e: IllegalArgumentException) {
            // Regex constructor throws PatternSyntaxException (extends IllegalArgumentException)
            // for invalid patterns. Return structured error instead of crashing.
            if (action.validator == UiTextValidator.Regex) {
                return UiActionStepResult(
                    id = action.id,
                    actionType = "read_text",
                    success = false,
                    data = mapOf(
                        "error" to "INVALID_REGEX_PATTERN",
                        "message" to (e.message ?: "Invalid regex pattern"),
                    ),
                )
            }
            throw e
        }
    }

    private suspend fun executeQueryUi(
        taskScope: TaskScope,
        action: UiAction.QueryUi,
    ): UiActionStepResult =
        try {
            val query = taskScope.ui { queryUi(action.matcher, action.visibility, action.limit) }
            UiActionStepResult(action.id, "query_ui", data = mapOf("query" to query))
        } catch (error: QueryPayloadTooLargeException) {
            UiActionStepResult(action.id, "query_ui", success = false, data = mapOf("error" to "PAYLOAD_TOO_LARGE", "message" to error.message.orEmpty()))
        }

    private suspend fun executeSnapshotUi(
        taskScope: TaskScope,
        action: UiAction.SnapshotUi,
    ): UiActionStepResult {
        // Snapshot action routes through TaskScope.logUiTree, the same core path used for UI hierarchy dumps.
        val snapshotResult = taskScope.logUiTree(retry = action.retry)

        return UiActionStepResult(
            id = action.id,
            actionType = "snapshot_ui",
            data =
                mapOf(
                    "actual_format" to snapshotResult.actualFormat.wireValue,
                ).let { base ->
                    buildMap {
                        putAll(base)
                        snapshotResult.hierarchyXml?.let { put("text", it) }
                        snapshotResult.foregroundPackage?.let { put("foreground_package", it) }
                        put("has_overlay", snapshotResult.hasOverlay.toString())
                        snapshotResult.overlayPackage?.let { put("overlay_package", it) }
                        snapshotResult.windowCount?.let { put("window_count", it.toString()) }
                        put("operator_overlay_visible", snapshotResult.operatorOverlayVisible.toString())
                    }
                },
        )
    }

    private suspend fun executeShowToast(
        action: UiAction.ShowToast,
    ): UiActionStepResult {
        val controller = checkNotNull(apiToastController) { "API toast controller is unavailable" }
        controller.show(action.text, action.duration)
        return UiActionStepResult(
            id = action.id,
            actionType = "show_toast",
            data = mapOf("submitted" to "true", "duration" to action.duration),
        )
    }

    private suspend fun executeCancelToast(
        action: UiAction.CancelToast,
    ): UiActionStepResult {
        val controller = checkNotNull(apiToastController) { "API toast controller is unavailable" }
        controller.cancel()
        return UiActionStepResult(
            id = action.id,
            actionType = "cancel_toast",
            data = mapOf("submitted" to "true"),
        )
    }

    private suspend fun executeSetOnScreenLog(
        action: UiAction.SetOnScreenLog,
    ): UiActionStepResult =
        when (val result = onScreenLogController.set(action.spec)) {
            is OnScreenLogControllerResult.Rendered ->
                UiActionStepResult(
                    id = action.id,
                    actionType = "set_on_screen_log",
                    data =
                        mapOf(
                            "visible" to "true",
                            "rendered" to "true",
                            "truncated" to result.truncated.toString(),
                            "anchor" to result.spec.anchor.wireValue,
                            "text_align" to result.spec.textAlign.wireValue,
                            "top_offset_dp" to result.spec.topOffsetDp.toString(),
                            "edge_offset_dp" to result.spec.edgeOffsetDp.toString(),
                            "width_dp" to result.spec.widthDp.toString(),
                            "font_size_sp" to result.spec.fontSizeSp.toString(),
                            "text_color" to result.spec.textColor,
                            "background_color" to result.spec.backgroundColor,
                            "ttl_ms" to result.spec.ttlMs.toString(),
                            "bounds" to result.bounds.toWireValue(),
                        ),
                )
            is OnScreenLogControllerResult.Failure ->
                UiActionStepResult(
                    id = action.id,
                    actionType = "set_on_screen_log",
                    success = false,
                    data =
                        mapOf(
                            "error" to result.errorCode,
                            "message" to result.message,
                        ),
                )
            OnScreenLogControllerResult.Cleared ->
                UiActionStepResult(
                    id = action.id,
                    actionType = "set_on_screen_log",
                    success = false,
                    data =
                        mapOf(
                            "error" to OnScreenLogErrorCodes.RENDER_FAILED,
                            "message" to "The panel controller cleared instead of rendering",
                        ),
                )
        }

    private suspend fun executeClearOnScreenLog(
        action: UiAction.ClearOnScreenLog,
    ): UiActionStepResult =
        when (val result = onScreenLogController.clear()) {
            OnScreenLogControllerResult.Cleared ->
                UiActionStepResult(
                    id = action.id,
                    actionType = "clear_on_screen_log",
                    data = mapOf("visible" to "false"),
                )
            is OnScreenLogControllerResult.Failure ->
                UiActionStepResult(
                    id = action.id,
                    actionType = "clear_on_screen_log",
                    success = false,
                    data =
                        mapOf(
                            "error" to result.errorCode,
                            "message" to result.message,
                        ),
                )
            is OnScreenLogControllerResult.Rendered ->
                UiActionStepResult(
                    id = action.id,
                    actionType = "clear_on_screen_log",
                    success = false,
                    data =
                        mapOf(
                            "error" to OnScreenLogErrorCodes.RENDER_FAILED,
                            "message" to "The panel controller rendered instead of clearing",
                        ),
                )
        }

    private suspend fun executeStartRecording(action: UiAction.StartRecording): UiActionStepResult =
        when (val outcome = recordingManager.startRecording(action.sessionId)) {
            is RecordingCommandOutcome.Started ->
                UiActionStepResult(
                    id = action.id,
                    actionType = "start_recording",
                    data =
                        buildMap {
                            put("sessionId", outcome.sessionId)
                            put("filePath", outcome.filePath)
                        },
                )
            is RecordingCommandOutcome.Error ->
                UiActionStepResult(
                    id = action.id,
                    actionType = "start_recording",
                    success = false,
                    data =
                        buildMap {
                            put("error", outcome.code)
                            put("message", outcome.message)
                            outcome.sessionId?.let { put("sessionId", it) }
                            outcome.filePath?.let { put("filePath", it) }
                        },
                )
            is RecordingCommandOutcome.Stopped ->
                UiActionStepResult(
                    id = action.id,
                    actionType = "start_recording",
                    success = false,
                    data = mapOf("error" to "RECORDING_START_FAILED", "message" to "Unexpected stop result from RecordingManager"),
                )
        }

    private suspend fun executeStopRecording(action: UiAction.StopRecording): UiActionStepResult =
        when (val outcome = recordingManager.stopRecording(action.sessionId)) {
            is RecordingCommandOutcome.Stopped ->
                UiActionStepResult(
                    id = action.id,
                    actionType = "stop_recording",
                    data =
                        buildMap {
                            put("sessionId", outcome.sessionId)
                            put("filePath", outcome.filePath)
                            put("eventCount", outcome.eventCount.toString())
                        },
                )
            is RecordingCommandOutcome.Error ->
                UiActionStepResult(
                    id = action.id,
                    actionType = "stop_recording",
                    success = false,
                    data =
                        buildMap {
                            put("error", outcome.code)
                            put("message", outcome.message)
                            outcome.sessionId?.let { put("sessionId", it) }
                            outcome.filePath?.let { put("filePath", it) }
                            outcome.eventCount?.let { put("eventCount", it.toString()) }
                        },
                )
            is RecordingCommandOutcome.Started ->
                UiActionStepResult(
                    id = action.id,
                    actionType = "stop_recording",
                    success = false,
                    data = mapOf("error" to "RECORDING_STOP_FAILED", "message" to "Unexpected start result from RecordingManager"),
                )
        }

    private suspend fun executeTakeScreenshot(
        taskScope: TaskScope,
        action: UiAction.TakeScreenshot,
    ): UiActionStepResult {
        // The Android runtime cannot reliably take screenshots of the system/other apps due to security restrictions.
        // We return an error here to signal that the 'Hand' (Node CLI) should handle this via ADB.
        return UiActionStepResult(
            id = action.id,
            actionType = "take_screenshot",
            success = false,
            data = mapOf(
                "error" to "UNSUPPORTED_RUNTIME_SCREENSHOT",
                "message" to "Android runtime cannot reliably capture screenshots. Use the Androperator Node API or 'adb exec-out screencap -p' directly for this action."
            ),
        )
    }

    private suspend fun executeEnterText(
        taskScope: TaskScope,
        action: UiAction.EnterText,
    ): UiActionStepResult {
        val submission = taskScope.ui {
            enterText(
                matcher = action.matcher,
                text = action.text,
                submit = action.submit,
                clear = action.clear,
                retry = action.retry,
                strict = action.strict,
                container = action.container,
            )
        }
        return UiActionStepResult(
            id = action.id,
            actionType = "enter_text",
            data =
                mapOf(
                    "text" to action.text,
                    "clear" to action.clear.toString(),
                    "submit" to action.submit.toString(),
                    "text_entry" to "accepted",
                    "submission" to when (submission) {
                        TextSubmissionOutcome.NotRequested -> "not_requested"
                        TextSubmissionOutcome.Unavailable -> "unavailable"
                        else -> "accepted"
                    },
                    "submit_method" to submission.wireValue,
                ),
        )
    }

    private suspend fun executeSleep(
        taskScope: TaskScope,
        action: UiAction.Sleep,
    ): UiActionStepResult {
        require(action.durationMs >= 0L) { "durationMs must be >= 0" }
        taskScope.pause(action.durationMs.milliseconds, action.retry)
        return UiActionStepResult(
            id = action.id,
            actionType = "sleep",
            data = mapOf("duration_ms" to action.durationMs.toString()),
        )
    }

    private suspend fun executeDoctorPing(
        taskScope: TaskScope,
        action: UiAction.DoctorPing,
    ): UiActionStepResult {
        val optionsEnabled = developerOptionsManager.isEnabled.first()
        val usbDebuggingEnabled = developerOptionsManager.isUsbDebuggingEnabled.first()
        return UiActionStepResult(
            id = action.id,
            actionType = "doctor_ping",
            data = mapOf(
                "developer_options_enabled" to optionsEnabled.toString(),
                "usb_debugging_enabled" to usbDebuggingEnabled.toString(),
                "screen_on" to deviceState.queryScreenOn().toString(),
                "device_locked" to deviceState.queryDeviceLocked.toString(),
                "user_unlocked" to deviceState.isUserUnlocked.toString(),
            ),
        )
    }

    private fun executePressKey(action: UiAction.PressKey): UiActionStepResult {
        val keyName = action.key.name.lowercase()
        val success = globalActionDispatcher.perform(action.key)

        return if (success) {
            UiActionStepResult(
                id = action.id,
                actionType = "press_key",
                data = mapOf("key" to keyName),
            )
        } else {
            Log.w("$TAG executePressKey: performGlobalAction returned false for key=$keyName")
            UiActionStepResult(
                id = action.id,
                actionType = "press_key",
                success = false,
                data = mapOf(
                    "key" to keyName,
                    "error" to "GLOBAL_ACTION_FAILED",
                ),
            )
        }
    }
}

/**
 * Returns a stable canonical wire value for the click types (e.g. "click", "long_click", "focus").
 * Uses the first type in [UiTreeClickTypes.ordered] so multi-type lists are representable in data output.
 */
private fun UiTreeClickTypes.toWireValue(): String =
    when (ordered.firstOrNull()) {
        UiTreeClickType.LongClick -> "long_click"
        UiTreeClickType.Focus -> "focus"
        else -> "click"
    }

/**
 * Returns the stable canonical wire value for a scroll outcome.
 * Enum names use camel case; wire values use snake_case for consistency with the rest of the API.
 */
private fun TaskScrollOutcome.toWireValue(): String =
    when (this) {
        TaskScrollOutcome.Moved -> "moved"
        TaskScrollOutcome.NoMovement -> "no_movement"
        TaskScrollOutcome.Unknown -> "unknown"
        TaskScrollOutcome.ContainerLost -> "container_lost"
        TaskScrollOutcome.EdgeReached -> "edge_reached"
        TaskScrollOutcome.GestureFailed -> "gesture_failed"
    }

private fun TaskScrollTerminationReason.toWireValue(): String =
    when (this) {
        TaskScrollTerminationReason.TargetFound -> "TARGET_FOUND"
        TaskScrollTerminationReason.EdgeReached -> "EDGE_REACHED"
        TaskScrollTerminationReason.MaxScrollsReached -> "MAX_SCROLLS_REACHED"
        TaskScrollTerminationReason.MaxDurationReached -> "MAX_DURATION_REACHED"
        TaskScrollTerminationReason.NoPositionChange -> "NO_POSITION_CHANGE"
        TaskScrollTerminationReason.ContainerNotFound -> "CONTAINER_NOT_FOUND"
        TaskScrollTerminationReason.ContainerNotScrollable -> "CONTAINER_NOT_SCROLLABLE"
        TaskScrollTerminationReason.ContainerLost -> "CONTAINER_LOST"
    }

/** Canonical names also cover failures before an action returns its normal result. */
private fun UiAction.wireType(): String = when (this) {
    is UiAction.NotificationMedia -> type
    is UiAction.OpenUri -> "open_uri"
    is UiAction.OpenApp -> "open_app"
    is UiAction.CloseApp -> "close_app"
    is UiAction.WaitForNode -> "wait_for_node"
    is UiAction.Swipe -> "swipe"
    is UiAction.Drag -> "drag"
    is UiAction.Click -> "click"
    is UiAction.ScrollAndClick -> "scroll_and_click"
    is UiAction.Scroll -> "scroll"
    is UiAction.ScrollUntil -> "scroll_until"
    is UiAction.ReadText -> "read_text"
    is UiAction.QueryUi -> "query_ui"
    is UiAction.SnapshotUi -> "snapshot_ui"
    is UiAction.ShowToast -> "show_toast"
    is UiAction.CancelToast -> "cancel_toast"
    is UiAction.SetOnScreenLog -> "set_on_screen_log"
    is UiAction.ClearOnScreenLog -> "clear_on_screen_log"
    is UiAction.StartRecording -> "start_recording"
    is UiAction.StopRecording -> "stop_recording"
    is UiAction.TakeScreenshot -> "take_screenshot"
    is UiAction.EnterText -> "enter_text"
    is UiAction.Sleep -> "sleep"
    is UiAction.DoctorPing -> "doctor_ping"
    is UiAction.PressKey -> "press_key"
    is UiAction.WaitForNavigation -> "wait_for_navigation"
    is UiAction.ReadKeyValuePair -> "read_key_value_pair"
}
