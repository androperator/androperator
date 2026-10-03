package androperator.workflow

import action.log.Log
import action.unit.Temperature
import androperator.apps.KnownAppsRepository
import androperator.task.runner.TaskRetryPresets
import androperator.task.runner.TaskScope
import androperator.task.runner.TaskScrollDirection
import androperator.task.runner.UiAction
import androperator.task.runner.UiActionEngine
import androperator.task.runner.UiActionPlan
import androperator.task.runner.UiTextValidator
import androperator.task.runner.nodeMatcher
import androperator.uitree.ToggleState
import androperator.uitree.UiTreeClickTypes
import kotlin.time.Duration
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.seconds

class WorkflowFactoryDefault(
    private val knownAppsRepository: KnownAppsRepository,
    private val uiActionEngine: UiActionEngine,
) : WorkflowFactory {
    private val googleHomeApplicationId: String get() = knownAppsRepository.googleHomeApplicationId
    private val switchBotApplicationId: String get() = knownAppsRepository.switchBotApplicationId

    private suspend fun TaskScope.openSwitchBotApp(postOpenPauseDuration: Duration = 3.seconds) {
        closeApp(
            switchBotApplicationId,
            retry = TaskRetryPresets.AppClose,
        )

        openApp(
            switchBotApplicationId,
            retry = TaskRetryPresets.AppLaunch,
        )
        pause(postOpenPauseDuration)
    }

    override suspend fun getSwitchBotTemperature(taskScope: TaskScope): Temperature =
        with(taskScope) {
            val result =
                uiActionEngine.execute(
                    taskScope = this,
                    plan =
                        UiActionPlan(
                            commandId = "workflow:temperature:get",
                            taskId = "workflow:temperature:get",
                            source = "workflow",
                            actions =
                                listOf(
                                    UiAction.CloseApp(
                                        id = "switchbot.close_app",
                                        applicationId = switchBotApplicationId,
                                        retry = TaskRetryPresets.AppClose,
                                    ),
                                    UiAction.OpenApp(
                                        id = "switchbot.open_app",
                                        applicationId = switchBotApplicationId,
                                        retry = TaskRetryPresets.AppLaunch,
                                    ),
                                    UiAction.Sleep(
                                        id = "switchbot.post_open_wait",
                                        durationMs = 3000,
                                    ),
                                    UiAction.SnapshotUi(
                                        id = "switchbot.snapshot_ui",
                                    ),
                                    UiAction.ReadText(
                                        id = "switchbot.read_temperature",
                                        matcher =
                                            nodeMatcher {
                                                resourceId("com.theswitchbot.switchbot:id/tvTemp")
                                            },
                                        retry = TaskRetryPresets.UiReadiness,
                                        validator = UiTextValidator.Temperature,
                                    ),
                                ),
                        ),
                )

            val rawTemperature =
                result.stepResults
                    .firstOrNull { it.id == "switchbot.read_temperature" }
                    ?.data
                    ?.get("text")
                    ?: throw IllegalStateException("Temperature text was not produced by action engine")
            val temperature = requireNotNull(Temperature.parse(rawTemperature)) { "Failed to parse temperature" }
            Log.d("[WorkflowFactory] Validated temperature reading: $temperature")

            temperature
        }

    /**
     * Clicks the SwitchBot "Press" action within a device card:
     * Node: com.theswitchbot.switchbot:id/abPress (clickable)
     *
     * Strategy:
     *  1) Try a direct click (fast path).
     *  2) If not visible, scroll vertically inside the device list:
     *     - Prefer homeRecyclerView; if that node isn’t scrollable, use the first scrollable descendant.
     *  3) Fallback to srlRoot if needed, with the same descendant resolution.
     *  4) On any failure path, log the UI tree for debugging and rethrow.
     */
    override suspend fun toggleSwitchBotSwitch(taskScope: TaskScope) = with(taskScope) {
        openSwitchBotApp()

        ui {
            val target = nodeMatcher { resourceId("com.theswitchbot.switchbot:id/abPress") }

            // 1) Fast path: try clicking directly
            runCatching {
                click(
                    matcher = target,
                    clickTypes = UiTreeClickTypes.Click,
                    retry = TaskRetryPresets.UiReadiness,
                )
                return@ui
            }.onFailure { Log.d("[Workflow] Direct click failed: ${it.message}") }

            // 2) Try scrolling within the main device grid/list
            val homeRecycler = nodeMatcher { resourceId("com.theswitchbot.switchbot:id/homeRecyclerView") }
            val scrolledOk = runCatching {
                clickAfterScroll(
                    target = target,
                    container = homeRecycler,
                    direction = TaskScrollDirection.Down, // content down = finger swipe up
                    maxSwipes = 10,
                    distanceRatio = 0.7f,
                    settleDelay = 250.milliseconds,
                    scrollRetry = TaskRetryPresets.UiScroll,
                    clickRetry = TaskRetryPresets.UiReadiness,
                    findFirstScrollableChild = true, // wrapper -> scrollable descendant
                    clickTypes = UiTreeClickTypes.Click,
                )
                true
            }.getOrElse { false }

            if (scrolledOk) return@ui

            // 3) Fallback: outer container (pull-to-refresh root)
            val srlRoot = nodeMatcher { resourceId("com.theswitchbot.switchbot:id/srlRoot") }
            runCatching {
                clickAfterScroll(
                    target = target,
                    container = srlRoot,
                    direction = TaskScrollDirection.Down,
                    maxSwipes = 10,
                    distanceRatio = 0.7f,
                    settleDelay = 250.milliseconds,
                    scrollRetry = TaskRetryPresets.UiScroll,
                    clickRetry = TaskRetryPresets.UiReadiness,
                    findFirstScrollableChild = true,
                    clickTypes = UiTreeClickTypes.Click,
                )
            }.onFailure {
                Log.d("[Workflow] Failed to locate/click abPress via all strategies: ${it.message}")
                // Dump UI for quick diagnosis and bubble up
                logUiTree()
                throw it
            }

            // Small settle to allow the press animation/state to propagate, if needed
            pause(0.5.seconds)
        }
    }

    override suspend fun getGoogleHomeAirConditionerStatus(taskScope: TaskScope): ToggleState =
        with(taskScope) {
            // Example: Open Google Home app and scroll to find a device
            closeApp(
                googleHomeApplicationId,
                retry = TaskRetryPresets.AppClose,
            )

            openApp(
                googleHomeApplicationId,
                retry = TaskRetryPresets.AppLaunch,
            )
            pause(1.seconds)

            getGoogleHomeAirConditionerStatus2025().also {
                Log.d("[WorkflowFactory] Detected air conditioner state: $it")
            }
        }

    private suspend fun TaskScope.navigateToPanasonicClimateDevice(): Unit = ui {
        // 1) Enter Climate category (scroll chips horizontally if needed on small screens)
        val categoryChipsContainer = nodeMatcher {
            resourceId("com.google.android.apps.chromecast.app:id/category_chips")
        }
        val climateChip = nodeMatcher {
            textEquals("Climate")
        }

        runCatching {
            clickAfterScroll(
                target = climateChip,
                container = categoryChipsContainer,
                direction = TaskScrollDirection.Right,
                maxSwipes = 5,
                clickTypes = UiTreeClickTypes.Click,
                findFirstScrollableChild = true,
            )
        }.onFailure {
            Log.d("[WorkflowFactory] Failed to scroll to and click Climate chip: ${it.message}")
            logUiTree()
            throw it
        }

        pause(1.seconds)

        // 2) Find and click Panasonic device in Climate section
        val climateContainer = nodeMatcher {
            resourceId("com.google.android.apps.chromecast.app:id/pager_home_tab")
        }
        val panasonicControl = nodeMatcher {
            resourceId("com.google.android.apps.chromecast.app:id/control")
            textContains("Panasonic")
        }

        runCatching {
            clickAfterScroll(
                target = panasonicControl,
                container = climateContainer,
                maxSwipes = 12,
                clickTypes = UiTreeClickTypes.LongClick,
            )
        }.onFailure {
            Log.d("[WorkflowFactory] Failed to open Panasonic card in Climate: ${it.message}")
            logUiTree()
            throw it
        }

        pause(2.seconds)
    }

    private suspend fun TaskScope.getGoogleHomeAirConditionerStatus2025(): ToggleState = ui {
        navigateToPanasonicClimateDevice()

        // Detect the current toggle state from the UI tree
        getCurrentToggleState(
            nodeMatcher { resourceId("com.google.android.apps.chromecast.app:id/climate_power_button") },
        )
    }

    private suspend fun TaskScope.getGoogleHomeAirConditionerStatusLegacy(): ToggleState = ui {
        // Navigate to devices tab
        click(
            matcher =
                nodeMatcher {
                    resourceId("com.google.android.apps.chromecast.app:id/bottom_navigation_bar_devices_item")
                },
            retry = TaskRetryPresets.AppLaunch,
        )

        pause(1.seconds)

        // Define target: Panasonic device in the list
        val target =
            nodeMatcher {
                resourceId("com.google.android.apps.chromecast.app:id/control")
                textContains("Panasonic")
            }

        // Define container: the RecyclerView containing devices
        val container =
            nodeMatcher {
                resourceId("com.google.android.apps.chromecast.app:id/home_view_recycler_view")
            }

        // Use the new convenience method that combines scrolling and clicking
        try {
            clickAfterScroll(
                target = target,
                clickTypes = UiTreeClickTypes.LongClick,
                container = container,
                maxSwipes = 12,
            )
            Log.d("[WorkflowFactory] Successfully scrolled to and clicked Panasonic device")
        } catch (e: Exception) {
            Log.d("[WorkflowFactory] Failed to scroll to and click Panasonic device: ${e.message}")
        }

        // Detect the current toggle state from the UI tree
        getCurrentToggleState(
            nodeMatcher { resourceId("com.google.android.apps.chromecast.app:id/climate_power_button") },
        )
    }

    override suspend fun setGoogleHomeAirConditionerStatus(
        taskScope: TaskScope,
        desiredState: ToggleState,
    ): ToggleState =
        with(taskScope) {
            require(desiredState != ToggleState.Unknown) { "Cannot set toggle to Unknown state" }

            // Example: Open Google Home app and scroll to find a device
            closeApp(
                googleHomeApplicationId,
                retry = TaskRetryPresets.AppClose,
            )

            openApp(
                googleHomeApplicationId,
                retry = TaskRetryPresets.AppLaunch,
            )
            pause(1.seconds)

            setGoogleHomeAirConditionerStatus2025(desiredState).also {
                Log.d("[WorkflowFactory] Detected air conditioner state: $it")
            }
        }

    private suspend fun TaskScope.setGoogleHomeAirConditionerStatus2025(
        desiredState: ToggleState
    ): ToggleState = ui {
        require(desiredState != ToggleState.Unknown) { "Cannot set toggle to Unknown state" }

        navigateToPanasonicClimateDevice()

        // Set the toggle to the desired state (same pattern as legacy code)
        setCurrentToggleState(
            target = nodeMatcher { resourceId("com.google.android.apps.chromecast.app:id/climate_power_button") },
            desiredState = desiredState,
        )
    }

    private suspend fun TaskScope.setGoogleHomeAirConditionerStatusLegacy(desiredState: ToggleState): ToggleState = ui {
        // Navigate to devices tab
        click(
            matcher =
                nodeMatcher {
                    resourceId("com.google.android.apps.chromecast.app:id/bottom_navigation_bar_devices_item")
                },
            retry = TaskRetryPresets.AppLaunch,
        )

        pause(1.seconds)

        // Define target: Panasonic device in the list
        val target =
            nodeMatcher {
                resourceId("com.google.android.apps.chromecast.app:id/control")
                textContains("Panasonic")
            }

        // Define container: the RecyclerView containing devices
        val container =
            nodeMatcher {
                resourceId("com.google.android.apps.chromecast.app:id/home_view_recycler_view")
            }

        // Use the new convenience method that combines scrolling and clicking
        try {
            clickAfterScroll(
                target = target,
                clickTypes = UiTreeClickTypes.LongClick,
                container = container,
                maxSwipes = 12,
            )
            Log.d("[WorkflowFactory] Successfully scrolled to and clicked Panasonic device")
        } catch (e: Exception) {
            Log.d("[WorkflowFactory] Failed to scroll to and click Panasonic device: ${e.message}")
        }

        pause(2.seconds)
        logUiTree()

        // Set the toggle to the desired state
        setCurrentToggleState(
            target = nodeMatcher { resourceId("com.google.android.apps.chromecast.app:id/climate_power_button") },
            desiredState = desiredState,
        )
    }

    override suspend fun logUiTree(taskScope: TaskScope) {
        with(taskScope) {
            ui {
                logUiTree()
            }
        }
    }
}
