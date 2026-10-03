package androperator.operator.command

import androperator.operator.OperatorDeviceIdProvider
import androperator.operator.agent.AgentCommand
import androperator.operator.agent.AgentCommandExecutor
import androperator.operator.task.TaskStatusReporter
import androperator.operator.task.failed
import androperator.operator.task.finished
import androperator.operator.task.started
import androperator.operator.task.wrapTaskResult
import androperator.routine.RoutineFactory
import androperator.routine.RoutineManager
import androperator.routine.RoutineRun
import androperator.routine.RoutineStatusSink
import androperator.routine.airconditioner.AirConditionerRunForDurationRoutineSpec
import androperator.routine.temperature.TemperatureRegulatorCoolRoutineSpec
import androperator.task.runner.TaskEvent
import androperator.task.runner.TaskResult
import androperator.task.runner.TaskStatusSink
import androperator.task.runner.UiAction
import androperator.uitree.ToggleState
import androperator.workflow.WorkflowManager
import kotlin.time.Duration

class OperatorCommandExecutorDefault(
    private val workflowManager: WorkflowManager,
    private val routineFactory: RoutineFactory,
    private val routineManager: RoutineManager,
    private val taskStatusReporter: TaskStatusReporter,
    private val commandStatusReporter: OperatorCommandStatusReporter,
    private val deviceIdProvider: OperatorDeviceIdProvider,
    private val agentCommandExecutor: AgentCommandExecutor,
) : OperatorCommandExecutor {
    // Small stabilization buffers reduce flakiness in intermediate Compose-driven UI states.
    private companion object {
        const val GOOGLE_HOME_WAIT_OPEN_MS = 3_500L
        const val GOOGLE_HOME_WAIT_AFTER_CATEGORY_MS = 1_500L
        const val GOOGLE_HOME_WAIT_CONTROLLER_MS = 3_000L
        const val GOOGLE_HOME_WAIT_BEFORE_TOGGLE_MS = 500L
        const val GOOGLE_HOME_WAIT_AFTER_TOGGLE_MS = 1_500L
    }
    // TODO: Map TaskStatusSink events to TaskStatusReporter.progress(...) for richer telemetry.
    private val noOpStatusSink =
        object : TaskStatusSink {
            override fun emit(event: TaskEvent) {
                // No-op - we handle status reporting at the command level
            }
        }

    private fun formatDurationForUser(duration: Duration): String {
        val totalSeconds = duration.inWholeSeconds
        return when {
            totalSeconds < 60 -> "${totalSeconds}s"
            totalSeconds % 60 == 0L -> "${duration.inWholeMinutes} min"
            else -> "${totalSeconds}s"
        }
    }

    override suspend fun execute(cmd: OperatorCommand) {
        val deviceId = deviceIdProvider.getId()

        when (cmd) {
            is OperatorCommand.AirConditionerOn -> executeAirConditionerOn(cmd, deviceId)
            is OperatorCommand.AirConditionerOff -> executeAirConditionerOff(cmd, deviceId)
            is OperatorCommand.AirConditionerStatus -> executeAirConditionerStatus(cmd, deviceId)
            is OperatorCommand.TemperatureGet -> executeTemperatureGet(cmd, deviceId)
            is OperatorCommand.UiTreeLog -> executeUiTreeLog(cmd, deviceId)
            is OperatorCommand.GarageDoorToggle -> executeGarageDoorToggle(cmd, deviceId)
            is OperatorCommand.TemperatureRegulate -> executeTemperatureRegulate(cmd, deviceId)
        }
    }

    private suspend fun executeAirConditionerOn(
        cmd: OperatorCommand.AirConditionerOn,
        deviceId: String,
    ) {
        if (cmd.duration != null) {
            executeAirConditionerOnDuration(cmd, cmd.duration, deviceId)
            return
        }

        // Fallback: existing fire-and-forget behavior
        executeAirConditionerOnNow(cmd, deviceId)
    }

    private suspend fun executeAirConditionerOnNow(
        cmd: OperatorCommand.AirConditionerOn,
        deviceId: String,
    ) {
        val result =
            taskStatusReporter.wrapTaskResult(
                taskId = cmd.taskId,
                deviceId = deviceId,
                startedMessage = "Executing A/C ON command",
                successMessage = "A/C turned ON successfully",
                successResultToString = { it },
            ) {
                commandStatusReporter.notifyUser("A/C → ON")
                commandStatusReporter.info("Operator: A/C ON (taskId=${cmd.taskId})")
                setAirConditionerStateViaAgent(
                    taskId = cmd.taskId,
                    desiredState = ToggleState.On,
                    preferredCardName = cmd.deviceName?.takeIf { it.isNotBlank() } ?: "AirTouch AC 1",
                    fallbackCardName = "Master, Thermostat",
                )
                TaskResult.Success("on")
            }
        when (result) {
            is TaskResult.Failed -> commandStatusReporter.warn("A/C → ON failed")
            is TaskResult.Success -> Unit // Success already handled
        }
    }

    private suspend fun executeAirConditionerOnDuration(
        cmd: OperatorCommand.AirConditionerOn,
        duration: Duration,
        deviceId: String,
    ) {
        commandStatusReporter.info("Starting timed A/C routine: duration=${duration}")

        val routineSpec =
            AirConditionerRunForDurationRoutineSpec(
                runDuration = duration,
            )

        val routineRun =
            RoutineRun(
                routine = routineFactory.createAirConditionerRunForDurationRoutine(),
                routineSpec = routineSpec,
                routineStatusSink = RoutineStatusSink(),
            )

        taskStatusReporter.started(taskId = cmd.taskId, deviceId = deviceId, message = "Starting timed A/C routine")

        try {
            routineManager.start { routineRun }
            taskStatusReporter.finished(
                taskId = cmd.taskId,
                deviceId = deviceId,
                message = "Timed A/C routine started successfully",
                result = "duration=${duration}",
            )
            commandStatusReporter.notifyUser("A/C → ON for ${formatDurationForUser(duration)}")
        } catch (e: Exception) {
            taskStatusReporter.failed(
                taskId = cmd.taskId,
                deviceId = deviceId,
                message = "Failed to start timed A/C routine: ${e.message}",
                errorCode = "ROUTINE_START_FAILED",
            )
            commandStatusReporter.warn("Failed to start timed A/C routine: ${e.message}")
        }
    }

    private suspend fun executeAirConditionerOff(
        cmd: OperatorCommand.AirConditionerOff,
        deviceId: String,
    ) {
        if (cmd.duration != null) {
            commandStatusReporter.info("A/C command duration requested: ${cmd.duration}")
            // TODO: Honour duration by scheduling revert after cmd.duration.
        }
        val result =
            taskStatusReporter.wrapTaskResult(
                taskId = cmd.taskId,
                deviceId = deviceId,
                startedMessage = "Executing A/C OFF command",
                successMessage = "A/C turned OFF successfully",
                successResultToString = { it },
            ) {
                commandStatusReporter.notifyUser("A/C → OFF")
                commandStatusReporter.info("Operator: A/C OFF (taskId=${cmd.taskId})")
                setAirConditionerStateViaAgent(
                    taskId = cmd.taskId,
                    desiredState = ToggleState.Off,
                    preferredCardName = cmd.deviceName?.takeIf { it.isNotBlank() } ?: "AirTouch AC 1",
                    fallbackCardName = "Master, Thermostat",
                )
                TaskResult.Success("off")
            }
        when (result) {
            is TaskResult.Failed -> commandStatusReporter.warn("A/C → OFF failed")
            is TaskResult.Success -> Unit // Success already handled
        }
    }

    private suspend fun executeAirConditionerStatus(
        cmd: OperatorCommand.AirConditionerStatus,
        deviceId: String,
    ) {
        val preferredCardName = cmd.deviceName?.takeIf { it.isNotBlank() } ?: "AirTouch AC 1"
        val fallbackCardName = "Master, Thermostat"

        val result =
            taskStatusReporter.wrapTaskResult(
                taskId = cmd.taskId,
                deviceId = deviceId,
                startedMessage = "Reading A/C status from Google Home",
                successMessage = "A/C status read completed",
                successResultToString = { value: String -> value },
            ) {
                val preferredResult = runAirConditionerStatusPlan(cmd.taskId, preferredCardName, "preferred")
                val execution =
                    when (preferredResult) {
                        is TaskResult.Success -> preferredResult.value
                        is TaskResult.Failed -> {
                            if (preferredCardName.contains(fallbackCardName)) {
                                throw IllegalStateException(preferredResult.reason, preferredResult.cause)
                            }

                            commandStatusReporter.info(
                                "A/C status preferred matcher failed ('${preferredCardName}'), retrying fallback ('${fallbackCardName}')",
                            )
                            when (val fallbackResult = runAirConditionerStatusPlan(cmd.taskId, fallbackCardName, "fallback")) {
                                is TaskResult.Success -> fallbackResult.value
                                is TaskResult.Failed -> throw IllegalStateException(fallbackResult.reason, fallbackResult.cause)
                            }
                        }
                    }

                val power = execution.stepResults.firstOrNull { it.id == "read-power" }?.data?.get("text") ?: "unknown"
                val mode = execution.stepResults.firstOrNull { it.id == "read-mode" }?.data?.get("text") ?: "unknown"
                val indoorTemp = execution.stepResults.firstOrNull { it.id == "read-indoor-temp" }?.data?.get("text") ?: "unknown"

                TaskResult.Success("power=$power, mode=$mode, indoor_temp=$indoorTemp")
            }

        when (result) {
            is TaskResult.Success -> {
                commandStatusReporter.notifyUser("A/C status → ${result.value}")
                commandStatusReporter.info("Operator: A/C status ${result.value}")
            }
            is TaskResult.Failed -> {
                commandStatusReporter.warn("A/C status read failed")
            }
        }
    }

    private suspend fun runAirConditionerStatusPlan(
        taskId: String,
        controllerCardMatcherTextContains: String,
        suffix: String,
    ): TaskResult<androperator.task.runner.UiActionExecutionResult> {
        val command =
            AgentCommand(
                commandId = "operator-climate-status-${taskId}-${suffix}",
                taskId = taskId,
                source = "operator-command",
                timeoutMs = 90_000L,
                actions =
                    listOf(
                        UiAction.CloseApp(
                            id = "close-google-home",
                            applicationId = "com.google.android.apps.chromecast.app",
                        ),
                        UiAction.OpenApp(
                            id = "open-google-home",
                            applicationId = "com.google.android.apps.chromecast.app",
                        ),
                        UiAction.Sleep(id = "wait-open", durationMs = GOOGLE_HOME_WAIT_OPEN_MS),
                        UiAction.ScrollAndClick(
                            id = "open-climate-category",
                            matcher = androperator.task.runner.nodeMatcher { textEquals("Climate") },
                            container = androperator.task.runner.nodeMatcher { resourceId("com.google.android.apps.chromecast.app:id/category_chips") },
                            direction = androperator.task.runner.TaskScrollDirection.Right,
                            maxSwipes = 6,
                            clickTypes = androperator.uitree.UiTreeClickTypes.Click,
                            findFirstScrollableChild = true,
                        ),
                        UiAction.Sleep(id = "wait-climate", durationMs = GOOGLE_HOME_WAIT_AFTER_CATEGORY_MS),
                        UiAction.ScrollAndClick(
                            id = "open-controller-card",
                            matcher = androperator.task.runner.nodeMatcher { textContains(controllerCardMatcherTextContains) },
                            container = androperator.task.runner.nodeMatcher { resourceId("com.google.android.apps.chromecast.app:id/pager_home_tab") },
                            maxSwipes = 8,
                            clickTypes = androperator.uitree.UiTreeClickTypes.LongClick,
                        ),
                        UiAction.Sleep(id = "wait-controller", durationMs = GOOGLE_HOME_WAIT_CONTROLLER_MS),
                        UiAction.ReadText(
                            id = "read-power",
                            matcher = androperator.task.runner.nodeMatcher { resourceId("com.google.android.apps.chromecast.app:id/low_value") },
                        ),
                        UiAction.ReadText(
                            id = "read-mode",
                            matcher = androperator.task.runner.nodeMatcher { resourceId("com.google.android.apps.chromecast.app:id/body_text") },
                        ),
                        UiAction.ReadText(
                            id = "read-indoor-temp",
                            matcher = androperator.task.runner.nodeMatcher { resourceId("com.google.android.apps.chromecast.app:id/first_value_title") },
                        ),
                    ),
            )

        return agentCommandExecutor.execute(command)
    }

    private suspend fun setAirConditionerStateViaAgent(
        taskId: String,
        desiredState: ToggleState,
        preferredCardName: String,
        fallbackCardName: String,
    ) {
        val expectedPower = if (desiredState == ToggleState.On) "on" else "off"

        val (statusExecution, cardNameUsed) =
            when (val preferredStatus = runAirConditionerStatusPlan(taskId, preferredCardName, "status-precheck-preferred")) {
                is TaskResult.Success -> preferredStatus.value to preferredCardName
                is TaskResult.Failed -> {
                    commandStatusReporter.info(
                        "A/C ${desiredState.name} precheck preferred matcher failed ('${preferredCardName}'), retrying fallback ('${fallbackCardName}')",
                    )
                    when (val fallbackStatus = runAirConditionerStatusPlan(taskId, fallbackCardName, "status-precheck-fallback")) {
                        is TaskResult.Success -> fallbackStatus.value to fallbackCardName
                        is TaskResult.Failed -> throw IllegalStateException(fallbackStatus.reason, fallbackStatus.cause)
                    }
                }
            }

        val precheckPower = statusExecution.stepResults.firstOrNull { it.id == "read-power" }?.data?.get("text") ?: "unknown"
        if (precheckPower.trim().lowercase() == expectedPower) {
            commandStatusReporter.info("A/C already $precheckPower; no toggle needed")
            return
        }

        val execution =
            when (
                val setResult =
                    runAirConditionerSetStatePlan(
                        taskId = taskId,
                        controllerCardMatcherTextContains = cardNameUsed,
                        desiredState = desiredState,
                        suffix = "set",
                    )
            ) {
                is TaskResult.Success -> setResult.value
                is TaskResult.Failed -> throw IllegalStateException(setResult.reason, setResult.cause)
            }

        val power = execution.stepResults.firstOrNull { it.id == "read-power-after" }?.data?.get("text") ?: "unknown"
        val normalizedPower = power.trim().lowercase()
        check(normalizedPower == expectedPower) {
            "A/C verification failed: expected=$expectedPower observed=$power"
        }
    }

    private suspend fun runAirConditionerSetStatePlan(
        taskId: String,
        controllerCardMatcherTextContains: String,
        desiredState: ToggleState,
        suffix: String,
    ): TaskResult<androperator.task.runner.UiActionExecutionResult> {
        val command =
            AgentCommand(
                commandId = "operator-ac-${desiredState.name.lowercase()}-${taskId}-${suffix}",
                taskId = taskId,
                source = "operator-command",
                timeoutMs = 90_000L,
                actions =
                    listOf(
                        UiAction.CloseApp(
                            id = "close-google-home",
                            applicationId = "com.google.android.apps.chromecast.app",
                        ),
                        UiAction.OpenApp(
                            id = "open-google-home",
                            applicationId = "com.google.android.apps.chromecast.app",
                        ),
                        UiAction.Sleep(id = "wait-open", durationMs = GOOGLE_HOME_WAIT_OPEN_MS),
                        UiAction.ScrollAndClick(
                            id = "open-climate-category",
                            matcher = androperator.task.runner.nodeMatcher { textEquals("Climate") },
                            container = androperator.task.runner.nodeMatcher { resourceId("com.google.android.apps.chromecast.app:id/category_chips") },
                            direction = androperator.task.runner.TaskScrollDirection.Right,
                            maxSwipes = 6,
                            clickTypes = androperator.uitree.UiTreeClickTypes.Click,
                            findFirstScrollableChild = true,
                        ),
                        UiAction.Sleep(id = "wait-climate", durationMs = GOOGLE_HOME_WAIT_AFTER_CATEGORY_MS),
                        UiAction.ScrollAndClick(
                            id = "open-controller-card",
                            matcher = androperator.task.runner.nodeMatcher { textContains(controllerCardMatcherTextContains) },
                            container = androperator.task.runner.nodeMatcher { resourceId("com.google.android.apps.chromecast.app:id/pager_home_tab") },
                            maxSwipes = 8,
                            clickTypes = androperator.uitree.UiTreeClickTypes.LongClick,
                        ),
                        UiAction.Sleep(id = "wait-controller", durationMs = GOOGLE_HOME_WAIT_CONTROLLER_MS),
                        UiAction.ReadText(
                            id = "read-power-before",
                            matcher = androperator.task.runner.nodeMatcher { resourceId("com.google.android.apps.chromecast.app:id/low_value") },
                        ),
                        UiAction.Sleep(id = "wait-before-toggle", durationMs = GOOGLE_HOME_WAIT_BEFORE_TOGGLE_MS),
                        UiAction.Click(
                            id = "toggle-aircon",
                            matcher = androperator.task.runner.nodeMatcher { resourceId("com.google.android.apps.chromecast.app:id/climate_power_button") },
                            clickTypes = androperator.uitree.UiTreeClickTypes.Click,
                        ),
                        UiAction.Sleep(id = "wait-after-toggle", durationMs = GOOGLE_HOME_WAIT_AFTER_TOGGLE_MS),
                        UiAction.ReadText(
                            id = "read-power-after",
                            matcher = androperator.task.runner.nodeMatcher { resourceId("com.google.android.apps.chromecast.app:id/low_value") },
                        ),
                    ),
            )

        return agentCommandExecutor.execute(command)
    }

    private suspend fun executeUiTreeLog(
        cmd: OperatorCommand.UiTreeLog,
        deviceId: String,
    ) {
        val result =
            taskStatusReporter.wrapTaskResult(
                taskId = cmd.taskId,
                deviceId = deviceId,
                startedMessage = "Starting UI tree logging",
                successMessage = "UI tree logging completed",
            ) {
                commandStatusReporter.notifyUser("Logging UI tree…")
                commandStatusReporter.info("Operator: UI tree log requested (taskId=${cmd.taskId})")
                workflowManager.logUiTree(noOpStatusSink)
            }
        when (result) {
            is TaskResult.Failed -> commandStatusReporter.warn("UI tree logging failed")
            is TaskResult.Success -> Unit // Success already handled
        }
    }

    private suspend fun executeTemperatureGet(
        cmd: OperatorCommand.TemperatureGet,
        deviceId: String,
    ) {
        val result =
            taskStatusReporter.wrapTaskResult(
                taskId = cmd.taskId,
                deviceId = deviceId,
                startedMessage = "Reading temperature sensor",
                successMessage = "Temperature reading completed",
                successResultToString = { it.toString() },
            ) {
                commandStatusReporter.notifyUser("Reading temperature…")
                commandStatusReporter.info("Operator: Temperature reading requested (taskId=${cmd.taskId})")
                workflowManager.getAmbientTemperature(noOpStatusSink)
            }
        when (result) {
            is TaskResult.Success -> {
                commandStatusReporter.info("Temperature: ${result.value}")
            }
            is TaskResult.Failed -> {
                commandStatusReporter.warn("Temperature reading failed")
            }
        }
    }

    private suspend fun executeGarageDoorToggle(
        cmd: OperatorCommand.GarageDoorToggle,
        deviceId: String,
    ) {
        val result =
            taskStatusReporter.wrapTaskResult(
                taskId = cmd.taskId,
                deviceId = deviceId,
                startedMessage = "Starting garage door toggle",
                successMessage = "Garage door toggle completed successfully",
            ) {
                commandStatusReporter.notifyUser("Toggling garage door…")
                commandStatusReporter.info("Operator: Garage door toggle requested (taskId=${cmd.taskId})")
                workflowManager.toggleGarageDoor(noOpStatusSink)
            }
        when (result) {
            is TaskResult.Failed -> commandStatusReporter.warn("Garage door toggle failed")
            is TaskResult.Success -> Unit // Success already handled
        }
    }

    private suspend fun executeTemperatureRegulate(
        cmd: OperatorCommand.TemperatureRegulate,
        deviceId: String,
    ) {
        commandStatusReporter.info("Starting temperature regulation routine")

        val routineSpec = TemperatureRegulatorCoolRoutineSpec()

        val routineRun =
            RoutineRun(
                routine = routineFactory.createTemperatureRegulatorCoolRoutine(),
                routineSpec = routineSpec,
                routineStatusSink = RoutineStatusSink(),
            )

        taskStatusReporter.started(taskId = cmd.taskId, deviceId = deviceId, message = "Starting temperature regulation routine")

        try {
            routineManager.start { routineRun }
            taskStatusReporter.finished(
                taskId = cmd.taskId,
                deviceId = deviceId,
                message = "Temperature regulation routine started successfully",
                result = "active",
            )
            commandStatusReporter.notifyUser("Temperature regulation active")
        } catch (e: Exception) {
            taskStatusReporter.failed(
                taskId = cmd.taskId,
                deviceId = deviceId,
                message = "Failed to start temperature regulation routine: ${e.message}",
                errorCode = "ROUTINE_START_FAILED",
            )
            commandStatusReporter.warn("Failed to start temperature regulation routine: ${e.message}")
        }
    }

    fun RoutineStatusSink() = object : RoutineStatusSink {
        override fun log(
            message: String,
            data: Map<String, String>,
        ) = commandStatusReporter.info("Routine: $message ${data.entries.joinToString()}")

        override fun stageStart(
            id: String,
            title: String,
            data: Map<String, String>,
        ) = commandStatusReporter.info("Routine stage started: $title")

        override fun stageSuccess(
            id: String,
            data: Map<String, String>,
        ) = commandStatusReporter.info("Routine stage succeeded: $id")

        override fun stageFailure(
            id: String,
            reason: String,
            data: Map<String, String>,
        ) = commandStatusReporter.warn("Routine stage failed: $id - $reason")
    }
}
