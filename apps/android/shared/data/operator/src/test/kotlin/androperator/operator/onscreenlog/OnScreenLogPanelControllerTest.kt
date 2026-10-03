package androperator.operator.onscreenlog

import android.accessibilityservice.AccessibilityService
import android.app.Application
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Surface
import android.view.WindowManager
import android.view.View
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo
import androperator.task.runner.OnScreenLogBounds
import androperator.task.runner.OnScreenLogControllerResult
import androperator.task.runner.OnScreenLogSpec
import androperator.task.runner.OnScreenLogValidationException
import androperator.uitree.OperatorOverlayWindowIdentity
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.assertFailsWith
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, application = Application::class, sdk = [Build.VERSION_CODES.P])
class OnScreenLogPanelControllerTest {
    @Test
    fun `device template refresh retains absolute expiry and does not resurrect after clear`() {
        val fixture = controllerFixture()
        val result = render(fixture.controller, OnScreenLogSpec(template = "{{device.model}}", ttlMs = 1000))
        assertIs<OnScreenLogControllerResult.Rendered>(result)
        fixture.clock.nowMs = 500
        fixture.controller.onConfigurationChanged()
        assertTrue(fixture.controller.isOperatorOverlayVisible)
        fixture.clock.nowMs = 1000
        fixture.scheduler.onlyScheduledRunnable().run()
        assertFalse(fixture.controller.isOperatorOverlayVisible)
        fixture.controller.onConfigurationChanged()
        assertFalse(fixture.controller.isOperatorOverlayVisible)
        render(fixture.controller, OnScreenLogSpec(template = "{{device.model}}"))
        runBlocking { fixture.controller.clear() }
        fixture.controller.onConfigurationChanged()
        assertFalse(fixture.controller.isOperatorOverlayVisible)
    }

    @Test
    fun `template layout failure on refresh closes the panel`() {
        val fixture = controllerFixture()
        render(fixture.controller, OnScreenLogSpec(template = "{{device.model}}"))
        fixture.displayAreaProvider.bounds = OnScreenLogBounds(0, 0, 100, 40)
        fixture.controller.onConfigurationChanged()
        assertFalse(fixture.controller.isOperatorOverlayVisible)
        fixture.displayAreaProvider.bounds = OnScreenLogBounds(0, 0, 1080, 2200)
        fixture.controller.onConfigurationChanged()
        assertFalse(fixture.controller.isOperatorOverlayVisible)
    }

    @Test
    fun `invalid replacement preserves the acknowledged panel`() {
        val fixture = controllerFixture()
        render(fixture.controller, OnScreenLogSpec(text = "first label"))

        assertFailsWith<OnScreenLogValidationException> {
            render(fixture.controller, OnScreenLogSpec(text = "  \t\n"))
        }

        assertTrue(fixture.controller.isOperatorOverlayVisible)
        assertEquals(1, fixture.windowHost.addCalls)
        assertEquals(0, fixture.windowHost.removeCalls)
        assertEquals(View.IMPORTANT_FOR_ACCESSIBILITY_NO, fixture.windowHost.lastView?.importantForAccessibility)
        assertFalse(fixture.windowHost.lastView?.isFocusable ?: true)
        assertFalse(fixture.windowHost.lastView?.isClickable ?: true)
    }

    @Test
    fun `invalid color replacement preserves the acknowledged panel and expiry`() {
        val fixture = controllerFixture()
        render(fixture.controller, OnScreenLogSpec(text = "first label"))
        val originalExpiry = fixture.scheduler.onlyScheduledRunnable()

        assertFailsWith<OnScreenLogValidationException> {
            render(
                fixture.controller,
                OnScreenLogSpec(
                    text = "replacement",
                    textColor = "not-a-color",
                ),
            )
        }

        assertTrue(fixture.controller.isOperatorOverlayVisible)
        assertEquals(1, fixture.windowHost.addCalls)
        assertEquals(0, fixture.windowHost.updateCalls)
        assertEquals(0, fixture.windowHost.removeCalls)
        assertEquals(originalExpiry, fixture.scheduler.onlyScheduledRunnable())
    }

    @Test
    fun `replacement updates one window and resets omitted style defaults`() {
        val fixture = controllerFixture()
        val first =
            render(
                fixture.controller,
                OnScreenLogSpec(
                    text = "first label",
                    textColor = "#001122",
                    backgroundColor = "#334455",
                ),
            )
        val second = render(fixture.controller, OnScreenLogSpec(text = "second label"))

        assertIs<OnScreenLogControllerResult.Rendered>(first)
        assertIs<OnScreenLogControllerResult.Rendered>(second)
        assertEquals("#FF001122", first.spec.textColor)
        assertEquals("#FF334455", first.spec.backgroundColor)
        assertEquals("#FFFFFFFF", second.spec.textColor)
        assertEquals("#B3000000", second.spec.backgroundColor)
        assertEquals(1, fixture.windowHost.addCalls)
        assertEquals(1, fixture.windowHost.updateCalls)
        assertEquals(0, fixture.windowHost.removeCalls)
        val layoutParams = fixture.windowHost.lastLayoutParams!!
        assertEquals(WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY, layoutParams.type)
        assertTrue(layoutParams.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE != 0)
        assertTrue(layoutParams.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE != 0)
        assertEquals(0, layoutParams.flags and WindowManager.LayoutParams.FLAG_SECURE)
    }

    @Test
    fun `old expiry cannot clear a newer generation`() {
        val fixture = controllerFixture()
        render(fixture.controller, OnScreenLogSpec(text = "first", ttlMs = 1_000L))
        val firstExpiry = fixture.scheduler.onlyScheduledRunnable()

        fixture.clock.nowMs = 500L
        render(fixture.controller, OnScreenLogSpec(text = "replacement", ttlMs = 1_000L))
        val replacementExpiry = fixture.scheduler.onlyScheduledRunnable()

        fixture.clock.nowMs = 1_000L
        fixture.scheduler.run(firstExpiry)
        assertTrue(fixture.controller.isOperatorOverlayVisible)
        assertEquals(0, fixture.windowHost.removeCalls)

        fixture.clock.nowMs = 1_500L
        fixture.scheduler.run(replacementExpiry)
        assertFalse(fixture.controller.isOperatorOverlayVisible)
        assertEquals(1, fixture.windowHost.removeCalls)
    }

    @Test
    fun `draw timeout removes pending view and a late draw cannot restore it`() {
        val fixture = controllerFixture(acknowledgeDraws = false, runScheduledImmediately = true)

        val result = render(fixture.controller, OnScreenLogSpec(text = "will time out"))

        assertIs<OnScreenLogControllerResult.Failure>(result)
        assertEquals("ON_SCREEN_LOG_RENDER_TIMEOUT", result.errorCode)
        assertFalse(fixture.controller.isOperatorOverlayVisible)
        assertEquals(1, fixture.windowHost.addCalls)
        assertEquals(1, fixture.windowHost.removeCalls)

        fixture.windowHost.lastView?.acknowledgeDrawForTest()
        assertFalse(fixture.controller.isOperatorOverlayVisible)
        assertEquals(1, fixture.windowHost.removeCalls)
    }

    @Test
    fun `draw acknowledgement deadline includes main thread attach work`() {
        val fixture = controllerFixture(advanceClockOnAddMs = 2_001L)

        val result = render(fixture.controller, OnScreenLogSpec(text = "deadline exceeded"))

        assertIs<OnScreenLogControllerResult.Failure>(result)
        assertEquals("ON_SCREEN_LOG_RENDER_TIMEOUT", result.errorCode)
        assertFalse(fixture.controller.isOperatorOverlayVisible)
        assertEquals(1, fixture.windowHost.addCalls)
        assertEquals(1, fixture.windowHost.removeCalls)
    }

    @Test
    fun `cancellation removes the pending view and a late draw cannot restore it`() =
        runBlocking {
            val fixture = controllerFixture(acknowledgeDraws = false)
            val render =
                async(start = CoroutineStart.UNDISPATCHED) {
                    fixture.controller.set(OnScreenLogSpec(text = "cancelled"))
                }

            assertEquals(1, fixture.windowHost.addCalls)
            render.cancelAndJoin()

            assertFalse(fixture.controller.isOperatorOverlayVisible)
            assertEquals(1, fixture.windowHost.removeCalls)
            fixture.windowHost.lastView?.acknowledgeDrawForTest()
            assertFalse(fixture.controller.isOperatorOverlayVisible)
            assertEquals(1, fixture.windowHost.removeCalls)
        }

    @Test
    fun `layout rejection preserves the acknowledged panel and its expiry`() {
        val fixture = controllerFixture()
        render(fixture.controller, OnScreenLogSpec(text = "still visible"))
        val originalExpiry = fixture.scheduler.onlyScheduledRunnable()
        fixture.displayAreaProvider.bounds = OnScreenLogBounds(0, 0, 100, 40)

        val rejected = render(fixture.controller, OnScreenLogSpec(text = "does not fit", widthDp = 280))

        assertIs<OnScreenLogControllerResult.Failure>(rejected)
        assertEquals("ON_SCREEN_LOG_LAYOUT_INVALID", rejected.errorCode)
        assertTrue(fixture.controller.isOperatorOverlayVisible)
        assertEquals(1, fixture.windowHost.addCalls)
        assertEquals(0, fixture.windowHost.updateCalls)
        assertEquals(0, fixture.windowHost.removeCalls)
        assertEquals(originalExpiry, fixture.scheduler.onlyScheduledRunnable())
    }

    @Test
    fun `configuration change recalculates the same logical panel without another window`() {
        val fixture = controllerFixture()
        render(
            fixture.controller,
            OnScreenLogSpec(
                text = "rotate me",
                anchor = androperator.task.runner.OnScreenLogAnchor.Right,
                edgeOffsetDp = 10,
                widthDp = 100,
            ),
        )
        val firstTitle = fixture.windowHost.lastLayoutParams!!.title.toString()
        fixture.displayAreaProvider.bounds = OnScreenLogBounds(0, 0, 2_200, 1_080)

        fixture.controller.onConfigurationChanged()

        assertTrue(fixture.controller.isOperatorOverlayVisible)
        assertEquals(1, fixture.windowHost.addCalls)
        assertEquals(1, fixture.windowHost.updateCalls)
        assertEquals(0, fixture.windowHost.removeCalls)
        assertTrue(fixture.windowHost.lastLayoutParams!!.x > 0)
        assertTrue(fixture.windowHost.lastLayoutParams!!.title.toString() != firstTitle)
    }

    @Test
    fun `configuration change waits for both pending replacement and reflow draws`() =
        runBlocking {
            val fixture = controllerFixture()
            render(fixture.controller, OnScreenLogSpec(text = "first label"))
            fixture.displayAreaProvider.bounds = OnScreenLogBounds(0, 0, 2_200, 1_080)
            fixture.windowHost.acknowledgeDraws = false

            val replacement =
                async(start = CoroutineStart.UNDISPATCHED) {
                    fixture.controller.set(
                        OnScreenLogSpec(
                            text = "replacement label",
                            anchor = androperator.task.runner.OnScreenLogAnchor.Right,
                            widthDp = 100,
                        ),
                    )
                }

            assertEquals(1, fixture.windowHost.updateCalls)
            val pendingTitle = fixture.windowHost.lastLayoutParams!!.title.toString()

            fixture.controller.onConfigurationChanged()

            // The old state must not overwrite the pending replacement generation.
            assertEquals(1, fixture.windowHost.updateCalls)
            fixture.windowHost.lastView?.acknowledgeDrawForTest()

            // The reflow is a new generation. The set result must not claim it has rendered until
            // its own draw acknowledgement arrives.
            assertEquals(2, fixture.windowHost.updateCalls)
            assertFalse(replacement.isCompleted)
            val reflowTitle = fixture.windowHost.lastLayoutParams!!.title.toString()
            fixture.windowHost.lastView?.acknowledgeDrawForTest()

            val result =
                assertIs<OnScreenLogControllerResult.Rendered>(
                    withTimeout(1_000L) {
                        replacement.await()
                    },
                )

            assertTrue(fixture.controller.isOperatorOverlayVisible)
            assertEquals(2, fixture.windowHost.updateCalls)
            assertTrue(reflowTitle != pendingTitle)
            assertEquals(reflowTitle, fixture.windowHost.lastLayoutParams!!.title.toString())
            assertEquals(fixture.windowHost.lastLayoutParams!!.x, result.bounds.left)
            assertEquals(fixture.windowHost.lastLayoutParams!!.y, result.bounds.top)
            assertEquals(0, fixture.windowHost.removeCalls)
        }

    @Test
    fun `deferred reflow cancels the prior generation expiry until it is acknowledged`() =
        runBlocking {
            val fixture = controllerFixture()
            render(fixture.controller, OnScreenLogSpec(text = "first label", ttlMs = 5_000L))
            fixture.displayAreaProvider.bounds = OnScreenLogBounds(0, 0, 2_200, 1_080)
            fixture.windowHost.acknowledgeDraws = false

            val replacement =
                async(start = CoroutineStart.UNDISPATCHED) {
                    fixture.controller.set(
                        OnScreenLogSpec(
                            text = "replacement label",
                            anchor = androperator.task.runner.OnScreenLogAnchor.Right,
                            ttlMs = 1_000L,
                        ),
                    )
                }

            fixture.controller.onConfigurationChanged()
            fixture.windowHost.lastView?.acknowledgeDrawForTest()

            // The first replacement generation has an expiry, but the pending reflow must cancel
            // it before waiting. Only the reflow draw timeout may remain scheduled here.
            assertEquals(1, fixture.scheduler.scheduledCount())
            fixture.clock.nowMs = 1_000L
            fixture.scheduler.runScheduledWithDelay(1_000L)
            assertTrue(fixture.controller.isOperatorOverlayVisible)
            assertFalse(replacement.isCompleted)

            fixture.windowHost.lastView?.acknowledgeDrawForTest()
            assertIs<OnScreenLogControllerResult.Rendered>(
                withTimeout(1_000L) {
                    replacement.await()
                },
            )

            // The reflow reuses the original absolute TTL and schedules only its own expiry.
            assertEquals(1, fixture.scheduler.scheduledCount())
        }

    @Test
    fun `legacy usable bounds preserve a left navigation bar and display cutout`() {
        assertEquals(
            OnScreenLogNavigationBarSide.Left,
            resolveLegacyNavigationBarSide(
                isLandscape = true,
                navigationBarWidthPx = 96,
                navigationBarCanMove = true,
                rotation = Surface.ROTATION_270,
            ),
        )

        val bounds =
            assertNotNull(
                resolveLegacyUsableBounds(
                    displayWidthPx = 2_400,
                    displayHeightPx = 1_080,
                    systemBarInsets = OnScreenLogEdgeInsets(left = 96, top = 84),
                    displayCutoutInsets = OnScreenLogEdgeInsets(left = 120),
                ),
            )

        assertEquals(OnScreenLogBounds(120, 84, 2_400, 1_080), bounds)
    }

    @Test
    @Config(sdk = [Build.VERSION_CODES.LOLLIPOP])
    fun `api 21 rejects unsupported accessibility overlay without attaching a window`() {
        val fixture = controllerFixture()

        val result = render(fixture.controller, OnScreenLogSpec(text = "unsupported"))

        assertIs<OnScreenLogControllerResult.Failure>(result)
        assertEquals("ON_SCREEN_LOG_RENDER_FAILED", result.errorCode)
        assertEquals(0, fixture.windowHost.addCalls)
        assertFalse(fixture.controller.isOperatorOverlayVisible)
    }

    @Test
    @Config(sdk = [Build.VERSION_CODES.Q])
    fun `pre api 30 uses the supported real-display compatibility bounds`() {
        val service = Robolectric.buildService(TestAccessibilityService::class.java).create().get()

        val bounds = assertNotNull(AndroidOnScreenLogDisplayAreaProvider().currentUsableBounds(service))

        assertTrue(bounds.width > 0)
        assertTrue(bounds.height > 0)
        assertTrue(bounds.top >= 0)
    }

    @Test
    fun `detach and invalid configuration remove the panel`() {
        val fixture = controllerFixture()
        render(fixture.controller, OnScreenLogSpec(text = "visible"))

        fixture.controller.detach()
        assertFalse(fixture.controller.isOperatorOverlayVisible)
        assertEquals(1, fixture.windowHost.removeCalls)

        fixture.controller.attach(fixture.service)
        render(fixture.controller, OnScreenLogSpec(text = "visible again"))
        fixture.displayAreaProvider.bounds = OnScreenLogBounds(0, 0, 100, 20)
        fixture.controller.onConfigurationChanged()

        assertFalse(fixture.controller.isOperatorOverlayVisible)
        assertEquals(2, fixture.windowHost.removeCalls)
    }

    @Test
    fun `owned identity uses the exact controller window title rather than package heuristics`() {
        val fixture = controllerFixture()
        render(fixture.controller, OnScreenLogSpec(text = "identity"))
        val title = fixture.windowHost.lastLayoutParams?.title?.toString()

        assertTrue(title?.startsWith("androperator.on_screen_log.") == true)
        assertTrue(
            fixture.controller.ownsOverlayWindow(
                OperatorOverlayWindowIdentity(
                    id = 91,
                    type = AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY,
                    title = title,
                ),
            ),
        )
        assertTrue(
            fixture.controller.ownsOverlayWindow(
                OperatorOverlayWindowIdentity(
                    id = 91,
                    type = AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY,
                    title = null,
                ),
            ),
        )
        assertFalse(
            fixture.controller.ownsOverlayWindow(
                OperatorOverlayWindowIdentity(
                    id = 92,
                    type = AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY,
                    title = title,
                ),
            ),
        )
    }

    private fun render(
        controller: OnScreenLogPanelController,
        spec: OnScreenLogSpec,
    ): OnScreenLogControllerResult =
        runBlocking {
            controller.set(spec)
        }

    private fun controllerFixture(
        acknowledgeDraws: Boolean = true,
        runScheduledImmediately: Boolean = false,
        advanceClockOnAddMs: Long = 0L,
    ): ControllerFixture {
        val service = Robolectric.buildService(TestAccessibilityService::class.java).create().get()
        val windowHost = RecordingWindowHost(acknowledgeDraws)
        val displayAreaProvider = FixedDisplayAreaProvider(OnScreenLogBounds(0, 0, 1_080, 2_200))
        val scheduler = RecordingScheduler(runScheduledImmediately)
        val clock = MutableMonotonicClock()
        windowHost.onAdd = { clock.nowMs += advanceClockOnAddMs }
        val controller =
            OnScreenLogPanelController(
                displayAreaProvider = displayAreaProvider,
                windowHostFactory = { windowHost },
                mainHandler = Handler(Looper.getMainLooper()),
                scheduler = scheduler,
                monotonicClock = clock,
            )
        controller.attach(service)
        return ControllerFixture(service, controller, windowHost, displayAreaProvider, scheduler, clock)
    }

    private data class ControllerFixture(
        val service: TestAccessibilityService,
        val controller: OnScreenLogPanelController,
        val windowHost: RecordingWindowHost,
        val displayAreaProvider: FixedDisplayAreaProvider,
        val scheduler: RecordingScheduler,
        val clock: MutableMonotonicClock,
    )

    class TestAccessibilityService : AccessibilityService() {
        override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

        override fun onInterrupt() = Unit
    }

    private class FixedDisplayAreaProvider(
        var bounds: OnScreenLogBounds,
    ) : OnScreenLogDisplayAreaProvider {
        override fun currentUsableBounds(service: AccessibilityService): OnScreenLogBounds = bounds
    }

    private class RecordingWindowHost(
        var acknowledgeDraws: Boolean,
    ) : OnScreenLogWindowHost {
        var addCalls = 0
        var updateCalls = 0
        var removeCalls = 0
        var lastView: OnScreenLogPanelView? = null
        var lastLayoutParams: WindowManager.LayoutParams? = null
        var onAdd: () -> Unit = {}

        override fun addView(
            view: OnScreenLogPanelView,
            layoutParams: WindowManager.LayoutParams,
        ) {
            addCalls += 1
            lastView = view
            lastLayoutParams = layoutParams
            onAdd()
            if (acknowledgeDraws) {
                view.acknowledgeDrawForTest()
            }
        }

        override fun updateViewLayout(
            view: OnScreenLogPanelView,
            layoutParams: WindowManager.LayoutParams,
        ) {
            updateCalls += 1
            lastView = view
            lastLayoutParams = layoutParams
            if (acknowledgeDraws) {
                view.acknowledgeDrawForTest()
            }
        }

        override fun removeView(view: OnScreenLogPanelView) {
            removeCalls += 1
        }
    }

    private class RecordingScheduler(
        private val runScheduledImmediately: Boolean,
    ) : OnScreenLogScheduler {
        private val scheduled = linkedMapOf<Runnable, Long>()

        override fun postDelayed(
            runnable: Runnable,
            delayMs: Long,
        ) {
            scheduled[runnable] = delayMs
            if (runScheduledImmediately) {
                run(runnable)
            }
        }

        override fun removeCallbacks(runnable: Runnable) {
            scheduled.remove(runnable)
        }

        fun onlyScheduledRunnable(): Runnable {
            assertEquals(1, scheduled.size)
            return scheduled.keys.single()
        }

        fun scheduledCount(): Int = scheduled.size

        fun runScheduledWithDelay(delayMs: Long) {
            scheduled
                .filterValues { it == delayMs }
                .keys
                .toList()
                .forEach(::run)
        }

        fun run(runnable: Runnable) {
            scheduled.remove(runnable)
            runnable.run()
        }
    }

    private class MutableMonotonicClock(
        var nowMs: Long = 0L,
    ) : OnScreenLogMonotonicClock {
        override fun elapsedRealtimeMs(): Long = nowMs
    }
}
