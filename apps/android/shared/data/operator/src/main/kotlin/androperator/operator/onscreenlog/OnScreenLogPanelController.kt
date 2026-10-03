package androperator.operator.onscreenlog

import action.log.Log
import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Display
import android.view.Gravity
import android.view.Surface
import android.view.WindowInsets
import android.view.WindowManager
import android.view.accessibility.AccessibilityWindowInfo
import androperator.operator.foreground.ForegroundApplicationObserver
import androperator.task.runner.NormalizedOnScreenLogSpec
import androperator.task.runner.OnScreenLogBounds
import androperator.task.runner.OnScreenLogContract
import androperator.task.runner.OnScreenLogController
import androperator.task.runner.OnScreenLogControllerResult
import androperator.task.runner.OnScreenLogErrorCodes
import androperator.task.runner.OnScreenLogGeometry
import androperator.task.runner.OnScreenLogLayoutException
import androperator.task.runner.OnScreenLogPanelGeometry
import androperator.task.runner.OnScreenLogSpec
import androperator.uitree.OperatorOverlayIdentity
import androperator.uitree.OperatorOverlayWindowIdentity
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.util.UUID
import kotlin.coroutines.resume

/** Lifecycle callbacks owned by [androperator.operator.accessibilityservice.OperatorAccessibilityService]. */
interface OnScreenLogPanelLifecycle {
    fun attach(service: AccessibilityService)

    fun detach()

    fun onConfigurationChanged()
}

/**
 * Service-owned accessibility-overlay renderer.
 *
 * All mutations run on the Android main thread. Expiry is generation-scoped and starts only once
 * the requested generation has drawn. The timer is cleanup only and never updates panel content.
 */
class OnScreenLogPanelController internal constructor(
    private val foregroundObserver: () -> ForegroundApplicationObserver = { error("Foreground observer not configured") },
    private val displayAreaProvider: OnScreenLogDisplayAreaProvider = AndroidOnScreenLogDisplayAreaProvider(),
    private val windowHostFactory: (WindowManager) -> OnScreenLogWindowHost = { windowManager ->
        AndroidOnScreenLogWindowHost(windowManager)
    },
    private val panelFactory: (Context) -> OnScreenLogPanelView = { context ->
        OnScreenLogPanelView(context)
    },
    private val mainHandler: Handler = Handler(Looper.getMainLooper()),
    private val scheduler: OnScreenLogScheduler = HandlerOnScreenLogScheduler(mainHandler),
    private val monotonicClock: OnScreenLogMonotonicClock = AndroidOnScreenLogMonotonicClock,
) : OnScreenLogController,
    OnScreenLogPanelLifecycle,
    OperatorOverlayIdentity {
    constructor(observer: () -> ForegroundApplicationObserver) : this(foregroundObserver = observer)

    constructor() : this(
        displayAreaProvider = AndroidOnScreenLogDisplayAreaProvider(),
        windowHostFactory = { windowManager -> AndroidOnScreenLogWindowHost(windowManager) },
        panelFactory = { context -> OnScreenLogPanelView(context) },
        mainHandler = Handler(Looper.getMainLooper()),
        scheduler = HandlerOnScreenLogScheduler(Handler(Looper.getMainLooper())),
        monotonicClock = AndroidOnScreenLogMonotonicClock,
    )

    companion object {
        private const val TAG = "[OnScreenLogPanel]"
        private const val WINDOW_TITLE_PREFIX = "androperator.on_screen_log"
    }

    private val operationMutex = Mutex()
    private var templateSession: OnScreenLogTemplateSession? = null
    private var templateContent: OnScreenLogContent? = null
    private var templateLifetime = 0L

    private var service: AccessibilityService? = null
    private var windowHost: OnScreenLogWindowHost? = null
    private var panelView: OnScreenLogPanelView? = null
    private var visibleState: VisiblePanelState? = null
    private var expiryRunnable: Runnable? = null
    private var pendingDrawAcknowledgement: PendingDrawAcknowledgement? = null
    private var configurationChangePending = false
    private var generationCounter = 0L
    private val controllerWindowNonce = UUID.randomUUID().toString()

    @Volatile
    private var visibleWindowTitle: String? = null

    @Volatile
    private var ownedWindowId: Int? = null

    override val isOperatorOverlayVisible: Boolean
        get() = visibleWindowTitle != null

    override fun ownsOverlayWindow(window: OperatorOverlayWindowIdentity): Boolean {
        if (window.type != AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY) {
            return false
        }

        val expectedTitle = visibleWindowTitle ?: return false
        val knownWindowId = ownedWindowId
        if (knownWindowId != null) {
            return knownWindowId == window.id
        }

        if (window.title == expectedTitle) {
            ownedWindowId = window.id
            return true
        }
        return false
    }

    override fun attach(service: AccessibilityService) {
        runOnMain {
            if (this.service !== service) {
                removePanel(reason = "service_replaced")
                this.service = service
                val windowManager = service.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
                windowHost = windowManager?.let(windowHostFactory)
                if (windowHost == null) {
                    Log.w("$TAG attach failed: WindowManager unavailable")
                }
            }
        }
    }

    override fun detach() {
        runOnMain {
            removePanel(reason = "service_detached")
            service = null
            windowHost = null
        }
    }

    override fun onConfigurationChanged() {
        runOnMain {
            // A set keeps the previous visible state until its generation draws. Reapplying that
            // state while the replacement waits for a draw would overwrite the replacement and
            // leave its acknowledgement waiting for a generation that can no longer draw.
            if (pendingDrawAcknowledgement != null) {
                configurationChangePending = true
                return@runOnMain
            }
            applyConfigurationChange()
            templateSession?.refresh()
        }
    }

    override suspend fun set(
        spec: OnScreenLogSpec,
        drawAcknowledgementTimeoutMs: Long,
    ): OnScreenLogControllerResult = setWithMetadataLoader(spec, drawAcknowledgementTimeoutMs) { context, packageName ->
        OnScreenLogTemplateSession.loadMetadata(context, packageName)
    }

    /** Injectable lookup seam for controlled Android lifecycle proof; no wire-level override. */
    internal suspend fun setWithMetadataLoader(
        spec: OnScreenLogSpec,
        drawAcknowledgementTimeoutMs: Long = OnScreenLogContract.MAX_DRAW_ACKNOWLEDGEMENT_MS,
        lookup: suspend (Context, String) -> OnScreenLogAppMetadata,
    ): OnScreenLogControllerResult =
        operationMutex.withLock {
            // Validate before touching expiry or an existing panel. Invalid replacement preserves state.
            val normalized = OnScreenLogContract.normalize(spec)
            if (drawAcknowledgementTimeoutMs <= 0L) {
                return@withLock OnScreenLogControllerResult.Failure(
                    errorCode = OnScreenLogErrorCodes.RENDER_TIMEOUT,
                    message = "No execution time remains for draw acknowledgement",
                )
            }
            val acknowledgementDeadlineElapsedRealtimeMs =
                monotonicClock.elapsedRealtimeMs() +
                    drawAcknowledgementTimeoutMs.coerceAtMost(OnScreenLogContract.MAX_DRAW_ACKNOWLEDGEMENT_MS)

            try {
                withContext(Dispatchers.Main.immediate) {
                    val currentService = service
                        ?: return@withContext OnScreenLogControllerResult.Failure(
                            errorCode = OnScreenLogErrorCodes.SERVICE_UNAVAILABLE,
                            message = "The Operator accessibility service is not connected",
                        )
                    val host = windowHost
                        ?: return@withContext OnScreenLogControllerResult.Failure(
                            errorCode = OnScreenLogErrorCodes.SERVICE_UNAVAILABLE,
                            message = "The Operator accessibility window manager is unavailable",
                        )
                    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP_MR1) {
                        return@withContext OnScreenLogControllerResult.Failure(
                            errorCode = OnScreenLogErrorCodes.RENDER_FAILED,
                            message = "Accessibility overlay windows require Android API 22 or later",
                        )
                    }

                    val candidateLifetime = templateLifetime + 1
                    val candidateSession = normalized.template?.let { template ->
                        OnScreenLogTemplateSession(
                            currentService, template, foregroundObserver, normalized.fontSizeSp,
                            publish = { content ->
                                if (templateLifetime == candidateLifetime && visibleState != null) {
                                    templateContent = content
                                    applyConfigurationChange()
                                }
                            },
                            failed = {
                                if (templateLifetime == candidateLifetime) removePanel("template_refresh_failed")
                            },
                            lookup = { packageName -> lookup(currentService, packageName) },
                        )
                    }
                    val candidateContent = candidateSession?.initial()
                    val replacement =
                        try {
                            preparePanel(currentService, normalized, candidateContent)
                        } catch (error: OnScreenLogLayoutException) {
                            candidateSession?.close()
                            return@withContext OnScreenLogControllerResult.Failure(
                                errorCode = OnScreenLogErrorCodes.LAYOUT_INVALID,
                                message = error.message ?: "Panel does not fit the usable display bounds",
                            )
                        }

                    templateSession?.close()
                    templateLifetime = candidateLifetime
                    templateSession = candidateSession
                    templateContent = candidateContent
                    val nextGeneration = nextGeneration()
                    cancelExpiry()
                    pendingDrawAcknowledgement?.complete(false)
                    pendingDrawAcknowledgement = null

                    val view = panelView ?: replacement.panel
                    val windowTitle = windowTitle(nextGeneration)
                    try {
                        view.apply(replacement.prepared, nextGeneration)
                        val layoutParams = createLayoutParams(replacement.bounds, windowTitle)
                        if (panelView == null) {
                            host.addView(view, layoutParams)
                            panelView = view
                        } else {
                            host.updateViewLayout(view, layoutParams)
                        }
                    } catch (error: Throwable) {
                        Log.e(error, "$TAG add_or_update failed generation=$nextGeneration")
                        removePanel(reason = "render_attach_failed")
                        return@withContext OnScreenLogControllerResult.Failure(
                            errorCode = OnScreenLogErrorCodes.RENDER_FAILED,
                            message = "The panel window could not be attached or updated",
                        )
                    }

                    val remainingAcknowledgementMs =
                        acknowledgementDeadlineElapsedRealtimeMs - monotonicClock.elapsedRealtimeMs()
                    if (remainingAcknowledgementMs <= 0L) {
                        removePanel(reason = "render_deadline_elapsed")
                        return@withContext OnScreenLogControllerResult.Failure(
                            errorCode = OnScreenLogErrorCodes.RENDER_TIMEOUT,
                            message = "The panel did not complete a draw before the acknowledgement deadline",
                        )
                    }

                    val acknowledged =
                        awaitDrawAcknowledgement(
                            view = view,
                            generation = nextGeneration,
                            timeoutMs = remainingAcknowledgementMs,
                        )
                    if (pendingDrawAcknowledgement?.generation == nextGeneration) {
                        pendingDrawAcknowledgement = null
                        view.onGenerationDrawn = null
                    }
                    if (!acknowledged) {
                        removePanel(reason = "render_not_acknowledged")
                        return@withContext OnScreenLogControllerResult.Failure(
                            errorCode = OnScreenLogErrorCodes.RENDER_TIMEOUT,
                            message = "The panel did not complete a draw before the acknowledgement deadline",
                        )
                    }

                    val state =
                        VisiblePanelState(
                            spec = normalized,
                            bounds = replacement.bounds,
                            truncated = replacement.prepared.truncated,
                            generation = nextGeneration,
                            windowTitle = windowTitle,
                            expiryAtElapsedRealtimeMs = monotonicClock.elapsedRealtimeMs() + normalized.ttlMs,
                        )
                    visibleState = state
                    visibleWindowTitle = state.windowTitle
                    ownedWindowId = null
                    scheduleExpiry(state)

                    val configurationFailure =
                        replayPendingConfigurationChange(acknowledgementDeadlineElapsedRealtimeMs)
                    if (configurationFailure != null) {
                        return@withContext configurationFailure
                    }
                    val renderedState =
                        visibleState
                            ?: return@withContext OnScreenLogControllerResult.Failure(
                                errorCode = OnScreenLogErrorCodes.RENDER_FAILED,
                                message = "The panel disappeared before the render result was finalized",
                            )
                    OnScreenLogControllerResult.Rendered(
                        spec = renderedState.spec,
                        bounds = renderedState.bounds,
                        truncated = renderedState.truncated,
                    ).also { templateSession?.start() }
                }
            } catch (cancelled: CancellationException) {
                withContext(NonCancellable + Dispatchers.Main.immediate) {
                    removePanel(reason = "render_cancelled")
                }
                throw cancelled
            } catch (error: Throwable) {
                Log.e(error, "$TAG render failed before acknowledgement")
                withContext(NonCancellable + Dispatchers.Main.immediate) {
                    removePanel(reason = "render_failed")
                }
                OnScreenLogControllerResult.Failure(
                    errorCode = OnScreenLogErrorCodes.RENDER_FAILED,
                    message = "The panel renderer failed before acknowledgement",
                )
            }
        }

    override suspend fun clear(): OnScreenLogControllerResult =
        operationMutex.withLock {
            withContext(Dispatchers.Main.immediate) {
                removePanel(reason = "clear")
                OnScreenLogControllerResult.Cleared
            }
        }

    /** Recalculate the stored logical panel after a configuration change on the Android main thread. */
    private fun applyConfigurationChange(): OnScreenLogControllerResult.Failure? {
        val state = visibleState ?: return null
        val currentService = service ?: return null
        val host = windowHost ?: return null
        val currentPanel = panelView ?: return null

        return try {
            val replacement = preparePanel(currentService, state.spec)
            val nextGeneration = nextGeneration()
            cancelExpiry()
            currentPanel.apply(replacement.prepared, nextGeneration)
            val replacementWindowTitle = windowTitle(nextGeneration)
            host.updateViewLayout(
                currentPanel,
                createLayoutParams(replacement.bounds, replacementWindowTitle),
            )
            val replacementState =
                state.copy(
                    bounds = replacement.bounds,
                    truncated = replacement.prepared.truncated,
                    generation = nextGeneration,
                    windowTitle = replacementWindowTitle,
                )
            visibleState = replacementState
            visibleWindowTitle = replacementState.windowTitle
            ownedWindowId = null
            currentPanel.invalidate()
            scheduleExpiry(replacementState)
            null
        } catch (error: OnScreenLogLayoutException) {
            Log.w("$TAG configuration_change hidden reason=${error.message}")
            removePanel(reason = "configuration_layout_invalid")
            OnScreenLogControllerResult.Failure(
                errorCode = OnScreenLogErrorCodes.LAYOUT_INVALID,
                message = "The panel no longer fits after the display configuration changed",
            )
        } catch (error: Throwable) {
            Log.e(error, "$TAG configuration_change hidden after renderer failure")
            removePanel(reason = "configuration_render_failed")
            OnScreenLogControllerResult.Failure(
                errorCode = OnScreenLogErrorCodes.RENDER_FAILED,
                message = "The panel could not be redrawn after the display configuration changed",
            )
        }
    }

    /**
     * Complete configuration events deferred while a replacement generation waited for its draw
     * acknowledgement. Every reflow created before the caller receives a rendered result is
     * itself acknowledged within the original deadline.
     */
    private suspend fun replayPendingConfigurationChange(
        acknowledgementDeadlineElapsedRealtimeMs: Long,
    ): OnScreenLogControllerResult.Failure? {
        while (configurationChangePending) {
            configurationChangePending = false
            val failure =
                applyDeferredConfigurationChange(acknowledgementDeadlineElapsedRealtimeMs)
            if (failure != null) {
                return failure
            }
        }
        return null
    }

    /**
     * Reflow a configuration change which was deferred during [set]. The caller is still waiting
     * for a rendered result, so retain the previous acknowledged state until this new generation
     * has drawn too.
     */
    private suspend fun applyDeferredConfigurationChange(
        acknowledgementDeadlineElapsedRealtimeMs: Long,
    ): OnScreenLogControllerResult.Failure? {
        val state = visibleState ?: return null
        val currentService = service ?: return null
        val host = windowHost ?: return null
        val currentPanel = panelView ?: return null

        return try {
            val replacement = preparePanel(currentService, state.spec)
            val nextGeneration = nextGeneration()
            val replacementWindowTitle = windowTitle(nextGeneration)
            // The currently stored state is still the previous acknowledged generation while
            // this reflow waits. Its expiry must not remove the new in-flight view.
            cancelExpiry()
            currentPanel.apply(replacement.prepared, nextGeneration)
            host.updateViewLayout(
                currentPanel,
                createLayoutParams(replacement.bounds, replacementWindowTitle),
            )

            val remainingAcknowledgementMs =
                acknowledgementDeadlineElapsedRealtimeMs - monotonicClock.elapsedRealtimeMs()
            if (remainingAcknowledgementMs <= 0L) {
                removePanel(reason = "configuration_render_deadline_elapsed")
                return OnScreenLogControllerResult.Failure(
                    errorCode = OnScreenLogErrorCodes.RENDER_TIMEOUT,
                    message = "The panel did not complete a draw before the acknowledgement deadline",
                )
            }

            val acknowledged =
                awaitDrawAcknowledgement(
                    view = currentPanel,
                    generation = nextGeneration,
                    timeoutMs = remainingAcknowledgementMs,
                )
            if (pendingDrawAcknowledgement?.generation == nextGeneration) {
                pendingDrawAcknowledgement = null
                currentPanel.onGenerationDrawn = null
            }
            if (!acknowledged) {
                removePanel(reason = "configuration_render_not_acknowledged")
                return OnScreenLogControllerResult.Failure(
                    errorCode = OnScreenLogErrorCodes.RENDER_TIMEOUT,
                    message = "The panel did not complete a draw before the acknowledgement deadline",
                )
            }

            val replacementState =
                state.copy(
                    bounds = replacement.bounds,
                    truncated = replacement.prepared.truncated,
                    generation = nextGeneration,
                    windowTitle = replacementWindowTitle,
                )
            visibleState = replacementState
            visibleWindowTitle = replacementState.windowTitle
            ownedWindowId = null
            scheduleExpiry(replacementState)
            null
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: OnScreenLogLayoutException) {
            Log.w("$TAG configuration_change hidden reason=${error.message}")
            removePanel(reason = "configuration_layout_invalid")
            OnScreenLogControllerResult.Failure(
                errorCode = OnScreenLogErrorCodes.LAYOUT_INVALID,
                message = "The panel no longer fits after the display configuration changed",
            )
        } catch (error: Throwable) {
            Log.e(error, "$TAG configuration_change hidden after renderer failure")
            removePanel(reason = "configuration_render_failed")
            OnScreenLogControllerResult.Failure(
                errorCode = OnScreenLogErrorCodes.RENDER_FAILED,
                message = "The panel could not be redrawn after the display configuration changed",
            )
        }
    }

    private fun preparePanel(
        service: AccessibilityService,
        spec: NormalizedOnScreenLogSpec,
        content: OnScreenLogContent? = templateContent,
    ): PreparedPanel {
        val usableBounds =
            displayAreaProvider.currentUsableBounds(service)
                ?: throw OnScreenLogLayoutException("The usable display bounds are unavailable")
        val density = service.resources.displayMetrics.density
        val scaledDensity = service.resources.displayMetrics.scaledDensity
        val panel = panelView ?: panelFactory(service)
        val completeTextLineHeightPx = panel.completeTextLineHeightPx(spec, scaledDensity)
        val geometry =
            OnScreenLogGeometry.resolve(
                spec = spec,
                density = density,
                scaledDensity = scaledDensity,
                usableBounds = usableBounds,
                completeTextLineHeightPx = completeTextLineHeightPx,
            )
        val prepared = panel.prepare(spec, geometry, content)
        val bounds =
            OnScreenLogBounds(
                left = geometry.bounds.left,
                top = geometry.bounds.top,
                right = geometry.bounds.right,
                bottom = geometry.bounds.top + prepared.heightPx,
            )
        return PreparedPanel(panel = panel, prepared = prepared, bounds = bounds)
    }

    private fun createLayoutParams(
        bounds: OnScreenLogBounds,
        title: String,
    ): WindowManager.LayoutParams =
        WindowManager.LayoutParams(
            bounds.width,
            bounds.height,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.LEFT
            x = bounds.left
            y = bounds.top
            this.title = title
        }

    private suspend fun awaitDrawAcknowledgement(
        view: OnScreenLogPanelView,
        generation: Long,
        timeoutMs: Long,
    ): Boolean =
        suspendCancellableCoroutine { continuation ->
            if (view.lastDrawnGeneration == generation) {
                continuation.resume(true)
                return@suspendCancellableCoroutine
            }

            val acknowledgement =
                PendingDrawAcknowledgement(
                    generation = generation,
                    completeCallback = { rendered ->
                        if (continuation.isActive) {
                            continuation.resume(rendered)
                        }
                    },
                    removeTimeout = scheduler::removeCallbacks,
                )
            val timeout =
                Runnable {
                    acknowledgement.complete(false)
                }
            acknowledgement.timeout = timeout
            pendingDrawAcknowledgement = acknowledgement
            view.onGenerationDrawn = { drawnGeneration ->
                if (drawnGeneration == acknowledgement.generation) {
                    acknowledgement.complete(true)
                }
            }
            scheduler.postDelayed(timeout, timeoutMs)
            continuation.invokeOnCancellation {
                acknowledgement.complete(false)
            }
        }

    private fun scheduleExpiry(state: VisiblePanelState) {
        cancelExpiry()
        val runnable =
            object : Runnable {
                override fun run() {
                    val current = visibleState
                    if (current == null || current.generation != state.generation) {
                        return
                    }
                    val remainingMs = current.expiryAtElapsedRealtimeMs - monotonicClock.elapsedRealtimeMs()
                    if (remainingMs > 0L) {
                        scheduler.postDelayed(this, remainingMs)
                        return
                    }
                    removePanel(reason = "expired_generation_${state.generation}")
                }
            }
        expiryRunnable = runnable
        val delayMs = (state.expiryAtElapsedRealtimeMs - monotonicClock.elapsedRealtimeMs()).coerceAtLeast(0L)
        scheduler.postDelayed(runnable, delayMs)
    }

    private fun cancelExpiry() {
        expiryRunnable?.let(scheduler::removeCallbacks)
        expiryRunnable = null
    }

    private fun removePanel(reason: String) {
        templateLifetime++
        templateSession?.close()
        templateSession = null
        templateContent = null
        nextGeneration()
        cancelExpiry()
        pendingDrawAcknowledgement?.complete(false)
        pendingDrawAcknowledgement = null
        configurationChangePending = false

        val view = panelView
        if (view != null) {
            view.onGenerationDrawn = null
            try {
                windowHost?.removeView(view)
            } catch (error: Throwable) {
                Log.w("$TAG remove failed reason=$reason error=${error.message}")
            }
        }
        panelView = null
        visibleState = null
        visibleWindowTitle = null
        ownedWindowId = null
    }

    private fun nextGeneration(): Long {
        generationCounter += 1L
        return generationCounter
    }

    private fun windowTitle(generation: Long): String =
        "$WINDOW_TITLE_PREFIX.$controllerWindowNonce.$generation"

    private fun runOnMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            mainHandler.post(block)
        }
    }

    private data class PreparedPanel(
        val panel: OnScreenLogPanelView,
        val prepared: OnScreenLogPanelView.Prepared,
        val bounds: OnScreenLogBounds,
    )

    private data class VisiblePanelState(
        val spec: NormalizedOnScreenLogSpec,
        val bounds: OnScreenLogBounds,
        val truncated: Boolean,
        val generation: Long,
        val windowTitle: String,
        val expiryAtElapsedRealtimeMs: Long,
    )

    private class PendingDrawAcknowledgement(
        val generation: Long,
        private val completeCallback: (Boolean) -> Unit,
        private val removeTimeout: (Runnable) -> Unit,
    ) {
        var timeout: Runnable? = null
        private val completed = java.util.concurrent.atomic.AtomicBoolean(false)

        fun complete(rendered: Boolean) {
            if (!completed.compareAndSet(false, true)) {
                return
            }
            timeout?.let(removeTimeout)
            completeCallback(rendered)
        }
    }
}

internal interface OnScreenLogMonotonicClock {
    fun elapsedRealtimeMs(): Long
}

internal object AndroidOnScreenLogMonotonicClock : OnScreenLogMonotonicClock {
    override fun elapsedRealtimeMs(): Long = SystemClock.elapsedRealtime()
}

internal interface OnScreenLogScheduler {
    fun postDelayed(
        runnable: Runnable,
        delayMs: Long,
    )

    fun removeCallbacks(runnable: Runnable)
}

private class HandlerOnScreenLogScheduler(
    private val handler: Handler,
) : OnScreenLogScheduler {
    override fun postDelayed(
        runnable: Runnable,
        delayMs: Long,
    ) {
        handler.postDelayed(runnable, delayMs)
    }

    override fun removeCallbacks(runnable: Runnable) {
        handler.removeCallbacks(runnable)
    }
}

internal interface OnScreenLogDisplayAreaProvider {
    fun currentUsableBounds(service: AccessibilityService): OnScreenLogBounds?
}

/** Insets from an outer edge of a legacy default display, in physical pixels. */
internal data class OnScreenLogEdgeInsets(
    val left: Int = 0,
    val top: Int = 0,
    val right: Int = 0,
    val bottom: Int = 0,
) {
    init {
        require(left >= 0 && top >= 0 && right >= 0 && bottom >= 0) {
            "display insets must not be negative"
        }
    }
}

internal enum class OnScreenLogNavigationBarSide {
    Left,
    Right,
    Bottom,
}

/**
 * Mirrors the framework's pre-R navigation-bar placement rule without assuming a right-side bar
 * in reverse landscape. A missing framework policy is unsafe to guess, so the caller fails
 * closed instead.
 */
internal fun resolveLegacyNavigationBarSide(
    isLandscape: Boolean,
    navigationBarWidthPx: Int,
    navigationBarCanMove: Boolean?,
    rotation: Int,
): OnScreenLogNavigationBarSide? {
    require(navigationBarWidthPx >= 0) { "navigation bar width must not be negative" }
    if (!isLandscape || navigationBarWidthPx == 0) {
        return OnScreenLogNavigationBarSide.Bottom
    }
    val canMove = navigationBarCanMove ?: return null
    if (!canMove) {
        return OnScreenLogNavigationBarSide.Bottom
    }
    return if (rotation == Surface.ROTATION_270) {
        OnScreenLogNavigationBarSide.Left
    } else {
        OnScreenLogNavigationBarSide.Right
    }
}

/** Combine legacy system-bar and display-cutout insets without applying overlapping edges twice. */
internal fun resolveLegacyUsableBounds(
    displayWidthPx: Int,
    displayHeightPx: Int,
    systemBarInsets: OnScreenLogEdgeInsets,
    displayCutoutInsets: OnScreenLogEdgeInsets,
): OnScreenLogBounds? {
    if (displayWidthPx <= 0 || displayHeightPx <= 0) {
        return null
    }
    val left = maxOf(systemBarInsets.left, displayCutoutInsets.left)
    val top = maxOf(systemBarInsets.top, displayCutoutInsets.top)
    val right = displayWidthPx - maxOf(systemBarInsets.right, displayCutoutInsets.right)
    val bottom = displayHeightPx - maxOf(systemBarInsets.bottom, displayCutoutInsets.bottom)
    return if (right > left && bottom > top) {
        OnScreenLogBounds(left = left, top = top, right = right, bottom = bottom)
    } else {
        null
    }
}

internal class AndroidOnScreenLogDisplayAreaProvider : OnScreenLogDisplayAreaProvider {
    override fun currentUsableBounds(service: AccessibilityService): OnScreenLogBounds? {
        val windowManager = service.getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return null
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val metrics = windowManager.currentWindowMetrics
                val bounds = metrics.bounds
                val insets =
                    metrics.windowInsets.getInsetsIgnoringVisibility(
                        WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout(),
                    )
                OnScreenLogBounds(
                    left = bounds.left + insets.left,
                    top = bounds.top + insets.top,
                    right = bounds.right - insets.right,
                    bottom = bounds.bottom - insets.bottom,
                )
            } else {
                legacyUsableBounds(service, windowManager)
            }
        } catch (error: Throwable) {
            Log.w("[OnScreenLogPanel] current usable bounds unavailable: ${error.message}")
            null
        }
    }

    @Suppress("DEPRECATION")
    private fun legacyUsableBounds(
        service: AccessibilityService,
        windowManager: WindowManager,
    ): OnScreenLogBounds? {
        val metrics = android.util.DisplayMetrics()
        val display = windowManager.defaultDisplay
        display.getRealMetrics(metrics)
        val systemBars = legacySystemBarInsets(service, display) ?: return null
        val displayCutoutInsets = legacyDisplayCutoutInsets(service, display) ?: return null
        return resolveLegacyUsableBounds(
            displayWidthPx = metrics.widthPixels,
            displayHeightPx = metrics.heightPixels,
            systemBarInsets = systemBars,
            displayCutoutInsets = displayCutoutInsets,
        )
    }

    private fun legacySystemBarInsets(
        service: AccessibilityService,
        display: Display,
    ): OnScreenLogEdgeInsets? {
        val statusBarHeight = systemDimensionPx(service, "status_bar_height")
        val navigationBarHeight = systemDimensionPx(service, "navigation_bar_height")
        val navigationBarWidth = systemDimensionPx(service, "navigation_bar_width")
        val navigationSide =
            resolveLegacyNavigationBarSide(
                isLandscape = service.resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE,
                navigationBarWidthPx = navigationBarWidth,
                navigationBarCanMove = systemBoolean(service, "config_navBarCanMove"),
                rotation = display.rotation,
            ) ?: return null
        return when (navigationSide) {
            OnScreenLogNavigationBarSide.Left ->
                OnScreenLogEdgeInsets(left = navigationBarWidth, top = statusBarHeight)
            OnScreenLogNavigationBarSide.Right ->
                OnScreenLogEdgeInsets(top = statusBarHeight, right = navigationBarWidth)
            OnScreenLogNavigationBarSide.Bottom ->
                OnScreenLogEdgeInsets(top = statusBarHeight, bottom = navigationBarHeight)
        }
    }

    private fun legacyDisplayCutoutInsets(
        service: AccessibilityService,
        display: Display,
    ): OnScreenLogEdgeInsets? =
        when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ->
                display.cutout?.let { cutout ->
                    OnScreenLogEdgeInsets(
                        left = cutout.safeInsetLeft,
                        top = cutout.safeInsetTop,
                        right = cutout.safeInsetRight,
                        bottom = cutout.safeInsetBottom,
                    )
                } ?: OnScreenLogEdgeInsets()
            Build.VERSION.SDK_INT == Build.VERSION_CODES.P && hasDeclaredBuiltInDisplayCutout(service) ->
                // Android 9 exposes DisplayCutout only from a WindowInsets instance. The service
                // has no public display-level query before an overlay is attached, so do not
                // attach potentially unsafe geometry just to discover the inset.
                null
            else -> OnScreenLogEdgeInsets()
        }

    private fun hasDeclaredBuiltInDisplayCutout(service: AccessibilityService): Boolean {
        val resourceId =
            service.resources.getIdentifier("config_mainBuiltInDisplayCutout", "string", "android")
        return resourceId > 0 && service.resources.getString(resourceId).isNotBlank()
    }

    private fun systemDimensionPx(
        service: AccessibilityService,
        name: String,
    ): Int {
        val resourceId = service.resources.getIdentifier(name, "dimen", "android")
        return if (resourceId > 0) service.resources.getDimensionPixelSize(resourceId) else 0
    }

    private fun systemBoolean(
        service: AccessibilityService,
        name: String,
    ): Boolean? {
        val resourceId = service.resources.getIdentifier(name, "bool", "android")
        return if (resourceId > 0) service.resources.getBoolean(resourceId) else null
    }
}

internal interface OnScreenLogWindowHost {
    fun addView(
        view: OnScreenLogPanelView,
        layoutParams: WindowManager.LayoutParams,
    )

    fun updateViewLayout(
        view: OnScreenLogPanelView,
        layoutParams: WindowManager.LayoutParams,
    )

    fun removeView(view: OnScreenLogPanelView)
}

private class AndroidOnScreenLogWindowHost(
    private val windowManager: WindowManager,
) : OnScreenLogWindowHost {
    override fun addView(
        view: OnScreenLogPanelView,
        layoutParams: WindowManager.LayoutParams,
    ) {
        windowManager.addView(view, layoutParams)
    }

    override fun updateViewLayout(
        view: OnScreenLogPanelView,
        layoutParams: WindowManager.LayoutParams,
    ) {
        windowManager.updateViewLayout(view, layoutParams)
    }

    override fun removeView(view: OnScreenLogPanelView) {
        windowManager.removeViewImmediate(view)
    }
}
