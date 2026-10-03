package androperator.operator.accessibilityservice

import action.coroutine.CoroutineScopes
import action.buildconfig.BuildConfig
import action.log.Log
import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.accessibilityservice.InputMethod
import android.content.res.Configuration
import android.os.Build
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import android.view.inputmethod.EditorInfo
import androidx.annotation.RequiresApi
import androperator.accessibilityservice.AccessibilityServiceManagerAndroid
import androperator.operator.recording.RecordingEventFilter
import androperator.operator.onscreenlog.OnScreenLogPanelLifecycle
import androperator.routine.RoutineManager
import androperator.operator.foreground.ForegroundApplicationObserver
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.koin.android.ext.android.inject
import org.koin.core.component.KoinComponent

class OperatorAccessibilityService :
    AccessibilityService(),
    KoinComponent {
    private val accessibilityServiceManager: AccessibilityServiceManagerAndroid by inject()
    private val buildConfig: BuildConfig by inject()
    private val routineManager: RoutineManager by inject()
    private val coroutineScopes: CoroutineScopes by inject()
    private val recordingEventFilter: RecordingEventFilter by inject()
    private val onScreenLogPanelLifecycle: OnScreenLogPanelLifecycle by inject()
    private val foregroundApplicationObserver: ForegroundApplicationObserver by inject()
    private var routineLoopJob: Job? = null
    private val recordingDiagnosticHook: RecordingDiagnosticHook? by lazy {
        if (buildConfig.debug) {
            RecordingDiagnosticHook()
        } else {
            null
        }
    }

    override fun onCreateInputMethod(): InputMethod {
        if (buildConfig.debug) {
            Log.d("[Operator-AccessibilityService] onCreateInputMethod()")
        }
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            OperatorAccessibilityInputMethod(
                service = this,
                enableLifecycleDiagnostics = buildConfig.debug,
            )
        } else {
            super.onCreateInputMethod()
        }
    }

    override fun onServiceConnected() {
        Log.d("[Operator-AccessibilityService] onServiceConnected()")

//         Configure enhanced accessibility service
        serviceInfo =
            serviceInfo?.apply {
                // Enhanced flags for better element discovery and interaction
                flags = flags or
                    AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS or
                    AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS or
                    AccessibilityServiceInfo.FLAG_INCLUDE_NOT_IMPORTANT_VIEWS or
                    AccessibilityServiceInfo.FLAG_REQUEST_TOUCH_EXPLORATION_MODE or
                    AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    flags = flags or AccessibilityServiceInfo.FLAG_INPUT_METHOD_EDITOR
                }

                // Keep TYPE_VIEW_SCROLLED in the production mask because recording mode
                // needs to observe scroll events and RecordingEventFilter records them
                // without snapshot capture.
                eventTypes = AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED or
                    AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                    AccessibilityEvent.TYPE_WINDOWS_CHANGED or
                    AccessibilityEvent.TYPE_VIEW_CLICKED or
                    AccessibilityEvent.TYPE_VIEW_FOCUSED or
                    AccessibilityEvent.TYPE_VIEW_SCROLLED or
                    AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED

                // Configure feedback and capabilities
                feedbackType = AccessibilityServiceInfo.FEEDBACK_ALL_MASK
                notificationTimeout = 100
            }

        Log.d("[Operator-AccessibilityService] Enhanced accessibility configured with flags: ${serviceInfo?.flags}")
        accessibilityServiceManager.setCurrentAccessibilityService(this, set = true)
        onScreenLogPanelLifecycle.attach(this)
        foregroundApplicationObserver.attach(this)
        runRecordingDiagnosticHook(
            hook = recordingDiagnosticHook,
            hookLabel = "for service connected",
        ) {
            onServiceConnected()
        }

        if (routineLoopJob == null) {
            routineLoopJob =
                coroutineScopes.io.launch {
                    try {
                        routineManager.runLoop()
                    } catch (t: Throwable) {
                        Log.e(t, "[Operator-AccessibilityService] RoutineManager loop terminated unexpectedly")
                    }
                }
            Log.d("[Operator-AccessibilityService] RoutineManager loop started")
        }
    }

    override fun onDestroy() {
        Log.d("[Operator-AccessibilityService] onDestroy()")
        foregroundApplicationObserver.detach(this)
        onScreenLogPanelLifecycle.detach()
        runRecordingDiagnosticHook(
            hook = recordingDiagnosticHook,
            hookLabel = "for service destroyed",
        ) {
            onServiceDestroyed()
        }
        accessibilityServiceManager.setCurrentAccessibilityService(this, set = false)

        routineManager.cancelCurrent()
        routineLoopJob?.cancel()
        routineLoopJob = null
        Log.d("[Operator-AccessibilityService] RoutineManager loop stopped")
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        onScreenLogPanelLifecycle.onConfigurationChanged()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (buildConfig.debug && event != null && foregroundApplicationObserver.isObserving) {
            android.util.Log.i(
                "ForegroundObservationEvent",
                "type=${event.eventType} eventUptimeMs=${event.eventTime} ingressUptimeMs=${android.os.SystemClock.uptimeMillis()} windowId=${event.windowId}",
            )
        }
        foregroundApplicationObserver.onAccessibilityEvent(this, event)
        try {
            recordingEventFilter.onAccessibilityEvent(this, event)
        } catch (t: Throwable) {
            Log.e(t, "[Operator-AccessibilityService] RecordingEventFilter failed for accessibility event")
        }
        runRecordingDiagnosticHook(
            hook = recordingDiagnosticHook,
            hookLabel = "for accessibility event",
        ) {
            onAccessibilityEvent(this@OperatorAccessibilityService, event)
        }
        Log.d("[Operator-AccessibilityService] onAccessibilityEvent($event)")
    }

    override fun onKeyEvent(event: KeyEvent): Boolean {
        try {
            recordingEventFilter.onKeyEvent(this, event)
        } catch (t: Throwable) {
            Log.e(t, "[Operator-AccessibilityService] RecordingEventFilter failed for key event")
        }
        runRecordingDiagnosticHook(
            hook = recordingDiagnosticHook,
            hookLabel = "for key event",
        ) {
            onKeyEvent(this@OperatorAccessibilityService, event)
        }
        return super.onKeyEvent(event)
    }

    override fun onInterrupt() {
        runRecordingDiagnosticHook(
            hook = recordingDiagnosticHook,
            hookLabel = "for interrupt",
        ) {
            onInterrupt()
        }
        Log.d("[Operator-AccessibilityService] onInterrupt()")
    }
}

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
private class OperatorAccessibilityInputMethod(
    service: AccessibilityService,
    private val enableLifecycleDiagnostics: Boolean,
) : InputMethod(service) {
    override fun onStartInput(
        attribute: EditorInfo,
        restarting: Boolean,
    ) {
        logLifecycle {
            Log.d(
                "[Operator-AccessibilityService] onStartInput(restarting=$restarting actionId=${attribute.actionId} imeOptions=${attribute.imeOptions})",
            )
        }
        super.onStartInput(attribute, restarting)
    }

    override fun onFinishInput() {
        logLifecycle {
            Log.d("[Operator-AccessibilityService] onFinishInput()")
        }
        super.onFinishInput()
    }

    override fun onUpdateSelection(
        oldSelStart: Int,
        oldSelEnd: Int,
        newSelStart: Int,
        newSelEnd: Int,
        candidatesStart: Int,
        candidatesEnd: Int,
    ) {
        logLifecycle {
            Log.d(
                "[Operator-AccessibilityService] onUpdateSelection(old=$oldSelStart:$oldSelEnd new=$newSelStart:$newSelEnd)",
            )
        }
        super.onUpdateSelection(
            oldSelStart,
            oldSelEnd,
            newSelStart,
            newSelEnd,
            candidatesStart,
            candidatesEnd,
        )
    }

    private inline fun logLifecycle(block: () -> Unit) {
        if (enableLifecycleDiagnostics) {
            block()
        }
    }
}

internal inline fun runRecordingDiagnosticHook(
    hook: RecordingDiagnosticHook?,
    hookLabel: String,
    block: RecordingDiagnosticHook.() -> Unit,
) {
    try {
        hook?.block()
    } catch (t: Throwable) {
        Log.e(t, "[Operator-AccessibilityService] RecordingDiagnosticHook failed $hookLabel")
    }
}
