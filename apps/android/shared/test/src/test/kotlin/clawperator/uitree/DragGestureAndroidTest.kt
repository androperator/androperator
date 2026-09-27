package clawperator.uitree

import android.os.Looper
import clawperator.accessibilityservice.AccessibilityServiceManagerAndroid
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runTest
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowAccessibilityService
import kotlin.test.*

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class DragGestureAndroidTest {
    private class Fixture {
        val service = Robolectric.buildService(UiTreeManagerAndroidTest.ReceiptService::class.java).create().get()
        val shadow = Shadow.extract<ShadowAccessibilityService>(service).apply { setCanDispatchGestures(true) }
        val manager = UiTreeManagerAndroid(AccessibilityServiceManagerAndroid().apply { setCurrentAccessibilityService(service, true) })
        fun complete(index: Int) = shadow.gesturesDispatched[index].let { it.callback().onCompleted(it.description()) }
    }

    @Test fun `drag holds then continues the same pointer and waits for release`() = runTest {
        val fixture = Fixture()
        val accepted = mutableListOf<Boolean>()
        val action = async(UiDispatchObservation { _, _, value -> accepted += value }) {
            fixture.manager.dragAt(10, 20, 100, 200, 1000, 500)
        }
        testScheduler.runCurrent()
        shadowOf(Looper.getMainLooper()).idle()
        val hold = fixture.shadow.gesturesDispatched.single().description().getStroke(0)
        assertEquals(1L, hold.duration)
        assertTrue(hold.willContinue())
        assertEquals(0f, android.graphics.PathMeasure(hold.path, false).length)
        assertFalse(action.isCompleted)
        // A slow service callback must not invent a shorter deadline than the command.
        testScheduler.advanceTimeBy(5000)
        assertFalse(action.isCompleted)
        fixture.complete(0)
        assertEquals(1, fixture.shadow.gesturesDispatched.size)
        shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(999))
        assertEquals(1, fixture.shadow.gesturesDispatched.size)
        shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(1))
        val move = fixture.shadow.gesturesDispatched[1].description().getStroke(0)
        assertEquals(
            hold.javaClass.getMethod("getId").invoke(hold),
            move.javaClass.getMethod("getContinuedStrokeId").invoke(move),
        )
        assertFalse(move.willContinue())
        assertEquals(500L, move.duration)
        val path = android.graphics.PathMeasure(move.path, false)
        val point = FloatArray(2)
        path.getPosTan(0f, point, null)
        assertContentEquals(floatArrayOf(10f, 20f), point)
        path.getPosTan(path.length, point, null)
        assertContentEquals(floatArrayOf(100f, 200f), point)
        fixture.complete(1)
        assertTrue(action.await())
        assertTrue(accepted.last())
    }

    @Test fun `cancellation during hold releases without moving`() = runTest {
        val fixture = Fixture()
        val action = async { fixture.manager.dragAt(10, 20, 100, 200, 1000, 500) }
        testScheduler.runCurrent()
        shadowOf(Looper.getMainLooper()).idle()
        action.cancel()
        testScheduler.runCurrent()
        shadowOf(Looper.getMainLooper()).idle()
        fixture.complete(0)
        val release = fixture.shadow.gesturesDispatched[1].description().getStroke(0)
        assertFalse(release.willContinue())
        assertEquals(1L, release.duration)
        assertEquals(0f, android.graphics.PathMeasure(release.path, false).length)
        fixture.complete(1)
        action.join()
        assertTrue(action.isCancelled)
        assertEquals(2, fixture.shadow.gesturesDispatched.size)
    }

    @Test fun `cancellation during acknowledged hold removes movement timer and releases`() = runTest {
        val fixture = Fixture()
        val action = async { fixture.manager.dragAt(10, 20, 100, 200, 1000, 500) }
        testScheduler.runCurrent()
        shadowOf(Looper.getMainLooper()).idle()
        fixture.complete(0)
        action.cancel()
        testScheduler.runCurrent()
        shadowOf(Looper.getMainLooper()).idle()
        val release = fixture.shadow.gesturesDispatched[1].description().getStroke(0)
        assertEquals(0f, android.graphics.PathMeasure(release.path, false).length)
        assertFalse(release.willContinue())
        fixture.complete(1)
        shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(2000))
        assertEquals(2, fixture.shadow.gesturesDispatched.size)
        action.join()
    }

    @Test fun `cancelled movement cannot start another gesture`() = runTest {
        val fixture = Fixture()
        val action = async { fixture.manager.dragAt(10, 20, 100, 200, 1000, 500) }
        testScheduler.runCurrent()
        shadowOf(Looper.getMainLooper()).idle()
        fixture.complete(0)
        shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(1000))
        action.cancel()
        testScheduler.runCurrent()
        shadowOf(Looper.getMainLooper()).idle()
        fixture.complete(1)
        action.join()
        assertEquals(2, fixture.shadow.gesturesDispatched.size)
    }

    @Test fun `rejected continuation preserves accepted hold and attempts release`() = runTest {
        val fixture = Fixture()
        val accepted = mutableListOf<Boolean>()
        val action = async(UiDispatchObservation { _, _, value -> accepted += value }) {
            fixture.manager.dragAt(10, 20, 100, 200, 1000, 500)
        }
        testScheduler.runCurrent()
        shadowOf(Looper.getMainLooper()).idle()
        fixture.shadow.setCanDispatchGestures(false)
        fixture.complete(0)
        shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofMillis(1000))
        assertFalse(action.await())
        assertTrue(accepted.last())
    }

    @Test fun `platform cancellation and initial rejection return failure`() = runTest {
        for (reject in listOf(true, false)) {
            val fixture = Fixture()
            fixture.shadow.setCanDispatchGestures(!reject)
            val action = async { fixture.manager.dragAt(10, 20, 100, 200, 1000, 500) }
            testScheduler.runCurrent()
            shadowOf(Looper.getMainLooper()).idle()
            if (!reject) fixture.shadow.gesturesDispatched.single().let { it.callback().onCancelled(it.description()) }
            assertFalse(action.await())
        }
    }

    @Test fun `invalid bounds endpoints and durations never dispatch`() = runTest {
        val fixture = Fixture()
        assertFalse(fixture.manager.dragAt(-1, 20, 100, 200, 1000, 500))
        assertFalse(fixture.manager.dragAt(10, 20, Int.MAX_VALUE, 200, 1000, 500))
        assertFalse(fixture.manager.dragAt(10, 20, 10, 20, 1000, 500))
        assertFalse(fixture.manager.dragAt(10, 20, 100, 200, 0, 500))
        assertFalse(fixture.manager.dragAt(10, 20, 100, 200, 1000, 10001))
        assertTrue(fixture.shadow.gesturesDispatched.isEmpty())
    }

    @Test @Config(sdk = [25])
    fun `unsupported android never dispatches`() = runTest {
        val fixture = Fixture()
        assertFalse(fixture.manager.dragAt(10, 20, 100, 200, 1000, 500))
        assertTrue(fixture.shadow.gesturesDispatched.isEmpty())
    }
}
