package androperator.operator.foreground

import android.accessibilityservice.AccessibilityService
import android.app.Application
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, application = Application::class, sdk = [34])
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class ForegroundApplicationObserverTest {
    private val appType = AccessibilityWindowInfo.TYPE_APPLICATION
    private val unavailable = ForegroundApplicationState.Unavailable
    private val first = ForegroundApplicationState.Available("example.first", 0)
    private val second = ForegroundApplicationState.Available("example.second", 0)

    private fun window(
        id: Int = 1,
        packageName: String? = "example.first",
        active: Boolean = false,
        focused: Boolean = false,
        type: Int = appType,
        displayId: Int = 0,
        owned: Boolean = false,
    ) = ForegroundWindow(id, type, displayId, active, focused, packageName, owned)

    private fun service() = Robolectric.buildService(OperatorAccessibilityServiceStub::class.java).create().get()

    private fun event(type: Int = AccessibilityEvent.TYPE_WINDOWS_CHANGED) = AccessibilityEvent.obtain(type)

    @Test
    fun `split screen follows input focus in both directions even when active flag lags`() {
        repeat(10) { index ->
            val firstFocused = index % 2 == 0
            assertEquals(
                if (firstFocused) first else second,
                selectForegroundApplication(
                    listOf(
                        window(active = !firstFocused, focused = firstFocused),
                        window(2, "example.second", active = firstFocused, focused = !firstFocused),
                    ), 0,
                ),
            )
        }
    }

    @Test
    fun `keyboard and exact owned overlay do not replace focused application`() {
        assertEquals(first, selectForegroundApplication(listOf(
            window(focused = true),
            window(2, "keyboard", active = true, focused = true, type = AccessibilityWindowInfo.TYPE_INPUT_METHOD),
            window(3, "operator", active = true, type = AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY, owned = true),
        ), 0))
        assertEquals(unavailable, selectForegroundApplication(listOf(
            window(focused = true),
            window(3, "other.overlay", active = true, type = AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY),
        ), 0))
    }

    @Test
    fun `system panels and lock are distinguished from unknown foreground`() {
        assertEquals(unavailable, selectForegroundApplication(listOf(window()), 0))
        assertEquals(ForegroundApplicationState.Locked, selectForegroundApplication(listOf(window(focused = true)), 0, locked = true))
        assertEquals(unavailable, selectForegroundApplication(listOf(window(packageName = null, focused = true)), 0))
        assertEquals(unavailable, selectForegroundApplication(listOf(window(packageName = "  ", active = true)), 0))
        assertEquals(unavailable, selectForegroundApplication(listOf(window(focused = true), window(2, focused = true)), 0))
        assertEquals(ForegroundApplicationState.SystemPanel(0), selectForegroundApplication(listOf(window(focused = true),
            window(2, type = AccessibilityWindowInfo.TYPE_SYSTEM, active = true)), 0))
        assertEquals(unavailable, selectForegroundApplication(emptyList(), 0))
    }

    @Test
    fun `launcher and application permission dialog are eligible and other displays are isolated`() {
        assertEquals(ForegroundApplicationState.Available("launcher", 0),
            selectForegroundApplication(listOf(window(packageName = "launcher", active = true)), 0))
        assertEquals(ForegroundApplicationState.Available("permissions", 0),
            selectForegroundApplication(listOf(window(), window(2, "permissions", focused = true)), 0))
        assertEquals(first, selectForegroundApplication(listOf(window(focused = true),
            window(2, focused = true, type = AccessibilityWindowInfo.TYPE_SYSTEM, displayId = 1)), 0))
    }

    @Test
    fun `subscription initial read deduplication cancellation and zero idle reads`() = runTest {
        val service = service()
        var reads = 0
        var state: ForegroundApplicationState = first
        val observer = ForegroundApplicationObserver(backgroundScope) { _, _ -> reads++; state }
        observer.attach(service)
        observer.onAccessibilityEvent(service, event())
        runCurrent()
        assertEquals(0, reads)
        val states = mutableListOf<ForegroundApplicationState>()
        val job = backgroundScope.launch { observer.observe().collect { states.add(it) } }
        runCurrent()
        assertEquals(listOf(unavailable, first), states)
        observer.onAccessibilityEvent(service, event())
        runCurrent()
        assertEquals(listOf(unavailable, first), states)
        state = second
        observer.onAccessibilityEvent(service, event(AccessibilityEvent.TYPE_VIEW_FOCUSED))
        runCurrent()
        assertEquals(second, states.last())
        job.cancelAndJoin()
        runCurrent()
        val readsBefore = reads
        observer.onAccessibilityEvent(service, event())
        advanceTimeBy(1000)
        runCurrent()
        assertEquals(readsBefore, reads)
    }

    @Test
    fun `disconnect reconnect and stale old service callbacks do not retain identity`() = runTest {
        val old = service()
        val replacement = service()
        val observer = ForegroundApplicationObserver(backgroundScope) { current, _ -> if (current === old) first else second }
        val states = mutableListOf<ForegroundApplicationState>()
        backgroundScope.launch { observer.observe().collect { states.add(it) } }
        runCurrent()
        assertEquals(listOf<ForegroundApplicationState>(unavailable), states)
        observer.attach(old)
        runCurrent()
        observer.detach(old)
        runCurrent()
        assertEquals(unavailable, states.last())
        observer.attach(replacement)
        runCurrent()
        observer.detach(old)
        observer.onAccessibilityEvent(old, event())
        runCurrent()
        assertEquals(second, states.last())
    }

    @Test
    fun `cancelled read that ignores cancellation cannot publish after newer read or detach`() = runTest {
        val service = service()
        val pending = CompletableDeferred<Unit>()
        var reads = 0
        val observer = ForegroundApplicationObserver(backgroundScope) { _, _ ->
            reads++
            if (reads == 1) { withContext(NonCancellable) { pending.await() }; first } else second
        }
        observer.attach(service)
        val states = mutableListOf<ForegroundApplicationState>()
        backgroundScope.launch { observer.observe().collect { states.add(it) } }
        runCurrent()
        observer.onAccessibilityEvent(service, event())
        runCurrent()
        assertEquals(second, states.last())
        observer.detach(service)
        pending.complete(Unit)
        runCurrent()
        assertEquals(unavailable, states.last())
        assertTrue(first !in states)
    }

    @Test
    fun `null roots retry boundedly then recover without a new event and exceptions clear old identity`() = runTest {
        val service = service()
        var reads = 0
        val observer = ForegroundApplicationObserver(backgroundScope) { _, _ ->
            reads++
            when (reads) { 1 -> unavailable; 2 -> first; else -> error("root unavailable") }
        }
        observer.attach(service)
        val states = mutableListOf<ForegroundApplicationState>()
        backgroundScope.launch { observer.observe().collect { states.add(it) } }
        runCurrent()
        advanceTimeBy(100)
        runCurrent()
        assertEquals(first, states.last())
        observer.onAccessibilityEvent(service, event())
        runCurrent()
        assertEquals(first, states.last())
        advanceTimeBy(2000)
        runCurrent()
        assertEquals(unavailable, states.last())
        assertEquals(5, reads)
    }

    @Test
    fun `disposing the last subscriber rejects a non cancellable late result`() = runTest {
        val service = service()
        val pending = CompletableDeferred<Unit>()
        val observer = ForegroundApplicationObserver(backgroundScope) { _, _ ->
            withContext(NonCancellable) { pending.await() }
            first
        }
        observer.attach(service)
        val states = mutableListOf<ForegroundApplicationState>()
        val job = backgroundScope.launch { observer.observe().collect { states.add(it) } }
        runCurrent()
        job.cancelAndJoin()
        runCurrent()
        pending.complete(Unit)
        runCurrent()
        assertEquals(listOf<ForegroundApplicationState>(unavailable), states)
        assertTrue(!observer.isObserving)
    }

    @Test
    fun `windows changed alone updates pane focus and event package is never identity`() = runTest {
        val service = service()
        var focused = first
        val observer = ForegroundApplicationObserver(backgroundScope) { _, _ -> focused }
        observer.attach(service)
        val states = mutableListOf<ForegroundApplicationState>()
        backgroundScope.launch { observer.observe().collect { states.add(it) } }
        runCurrent()
        repeat(8) { index ->
            focused = if (index % 2 == 0) second else first
            observer.onAccessibilityEvent(service, event().apply { packageName = "example.keyboard" })
            runCurrent()
            assertEquals(focused, states.last())
        }
        assertEquals(10, states.size)
    }

    @Test
    fun `slow consumer receives latest state rather than queued stale identities`() = runTest {
        val service = service()
        var current = first
        val observer = ForegroundApplicationObserver(backgroundScope) { _, _ -> current }
        observer.attach(service)
        val blockedConsumer = CompletableDeferred<Unit>()
        val states = mutableListOf<ForegroundApplicationState>()
        backgroundScope.launch {
            observer.observe().collect {
                states.add(it)
                blockedConsumer.await()
            }
        }
        runCurrent()
        current = second
        observer.onAccessibilityEvent(service, event())
        runCurrent()
        observer.detach(service)
        runCurrent()
        blockedConsumer.complete(Unit)
        runCurrent()
        assertEquals(listOf<ForegroundApplicationState>(unavailable), states)
    }

    @Test
    fun `system panel preserves verified app but lock unavailable and reconnect clear it`() = runTest {
        val service = service()
        var current: ForegroundApplicationState = first
        val observer = ForegroundApplicationObserver(backgroundScope) { _, _ -> current }
        observer.attach(service)
        val states = mutableListOf<ForegroundApplicationState>()
        backgroundScope.launch { observer.observe().collect { states.add(it) } }
        runCurrent()
        fun update(state: ForegroundApplicationState) {
            current = state
            observer.onAccessibilityEvent(service, event())
            runCurrent()
        }
        val panel = ForegroundApplicationState.SystemPanel(0)
        update(panel)
        assertEquals(panel.copy(foregroundApp = first.foregroundApp), states.last())
        assertEquals("system_panel", states.last().foregroundState)
        update(second)
        assertEquals("app_focused", states.last().foregroundState)
        update(panel)
        assertEquals(second.foregroundApp, states.last().foregroundApp)
        update(ForegroundApplicationState.Locked)
        assertEquals(null, states.last().foregroundApp)
        update(panel)
        assertEquals(panel, states.last())
        update(first)
        update(unavailable)
        advanceTimeBy(350)
        runCurrent()
        update(panel)
        assertEquals(panel, states.last())
        update(first)
        observer.detach(service)
        current = panel
        observer.attach(service)
        runCurrent()
        assertEquals(panel, states.last())
    }

    @Test
    fun `transient missing window before shade does not discard app context`() = runTest {
        val service = service()
        var current: ForegroundApplicationState = first
        val observer = ForegroundApplicationObserver(backgroundScope) { _, _ -> current }
        observer.attach(service)
        val states = mutableListOf<ForegroundApplicationState>()
        backgroundScope.launch { observer.observe().collect { states.add(it) } }
        runCurrent()
        current = unavailable
        observer.onAccessibilityEvent(service, event())
        runCurrent()
        assertEquals(first, states.last())
        current = ForegroundApplicationState.SystemPanel(0)
        advanceTimeBy(100)
        runCurrent()
        assertEquals(ForegroundApplicationState.SystemPanel(0, first.foregroundApp), states.last())
        assertEquals(listOf(unavailable, first, states.last()), states)
    }

    @Test
    fun `last bounded retry resolves panel before unavailable deadline clears context`() = runTest {
        val service = service()
        var current: ForegroundApplicationState = first
        val observer = ForegroundApplicationObserver(backgroundScope) { _, _ -> current }
        observer.attach(service)
        val states = mutableListOf<ForegroundApplicationState>()
        backgroundScope.launch { observer.observe().collect { states.add(it) } }
        runCurrent()
        current = unavailable
        observer.onAccessibilityEvent(service, event())
        runCurrent()
        advanceTimeBy(200)
        runCurrent()
        current = ForegroundApplicationState.SystemPanel(0)
        advanceTimeBy(200)
        runCurrent()
        assertEquals(listOf(unavailable, first, ForegroundApplicationState.SystemPanel(0, first.foregroundApp)), states)
    }

    @Test
    fun `repeated missing-window events cannot extend unavailable deadline`() = runTest {
        val service = service()
        var current: ForegroundApplicationState = first
        val observer = ForegroundApplicationObserver(backgroundScope) { _, _ -> current }
        observer.attach(service)
        val states = mutableListOf<ForegroundApplicationState>()
        backgroundScope.launch { observer.observe().collect { states.add(it) } }
        runCurrent()
        current = unavailable
        repeat(4) {
            observer.onAccessibilityEvent(service, event())
            runCurrent()
            advanceTimeBy(100)
        }
        runCurrent()
        assertEquals(unavailable, states.last())
        current = ForegroundApplicationState.SystemPanel(0)
        observer.onAccessibilityEvent(service, event())
        runCurrent()
        assertEquals(ForegroundApplicationState.SystemPanel(0), states.last())
    }

    @Test
    fun `panel history belongs to subscription and display and panel does not retry`() = runTest {
        val service = service()
        var panelOpen = false
        var reads = 0
        val observer = ForegroundApplicationObserver(backgroundScope) { _, display ->
            reads++
            if (panelOpen) ForegroundApplicationState.SystemPanel(display)
            else ForegroundApplicationState.Available("example.display$display", display)
        }
        observer.attach(service)
        val states = mutableListOf<ForegroundApplicationState>()
        val otherDisplay = mutableListOf<ForegroundApplicationState>()
        val firstJob = backgroundScope.launch { observer.observe().collect { states.add(it) } }
        backgroundScope.launch { observer.observe(1).collect { otherDisplay.add(it) } }
        runCurrent()
        panelOpen = true
        observer.onAccessibilityEvent(service, event())
        runCurrent()
        assertEquals(ForegroundApplicationIdentity("example.display0", 0), states.last().foregroundApp)
        assertEquals(ForegroundApplicationIdentity("example.display1", 1), otherDisplay.last().foregroundApp)
        val before = reads
        advanceTimeBy(1000)
        runCurrent()
        assertEquals(before, reads)
        firstJob.cancelAndJoin()
        val fresh = mutableListOf<ForegroundApplicationState>()
        backgroundScope.launch { observer.observe().collect { fresh.add(it) } }
        runCurrent()
        assertEquals(ForegroundApplicationState.SystemPanel(0), fresh.last())
        assertEquals(ForegroundApplicationIdentity("example.display1", 1), otherDisplay.last().foregroundApp)
    }

    @Test
    fun `multiple consumers share reads and cancelling one preserves the other`() = runTest {
        val service = service()
        var reads = 0
        val observer = ForegroundApplicationObserver(backgroundScope) { _, display ->
            reads++
            ForegroundApplicationState.Available("example.first", display)
        }
        observer.attach(service)
        val one = backgroundScope.launch { observer.observe().collect {} }
        val states = mutableListOf<ForegroundApplicationState>()
        backgroundScope.launch { observer.observe().collect { states.add(it) } }
        runCurrent()
        one.cancelAndJoin()
        runCurrent()
        val before = reads
        observer.onAccessibilityEvent(service, event())
        runCurrent()
        assertEquals(before + 1, reads)
        assertEquals(first, states.last())
    }
}

class OperatorAccessibilityServiceStub : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit
}
