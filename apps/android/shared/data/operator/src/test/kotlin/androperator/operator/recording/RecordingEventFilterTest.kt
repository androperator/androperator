package androperator.operator.recording

import action.buildconfig.BuildConfigMock
import android.accessibilityservice.AccessibilityService
import android.app.Application
import android.content.Context
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import androidx.test.core.app.ApplicationProvider
import androperator.task.runner.RecordingCommandOutcome
import androperator.task.runner.RecordingManager
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, application = Application::class)
class RecordingEventFilterTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun `self events are filtered before enqueue`() = runTest {
        val manager = FakeRecordingManager(active = true)
        val filter =
            RecordingEventFilterDefault(
                recordingManager = manager,
                buildConfig = BuildConfigMock().apply { _debug = true },
            )
        val event =
            AccessibilityEvent.obtain(AccessibilityEvent.TYPE_VIEW_CLICKED).apply {
                packageName = "com.androperator.operator.dev"
                className = "android.widget.Button"
            }

        filter.onAccessibilityEvent(TestAccessibilityService(context), event)

        assertEquals(0, manager.enqueuedEvents.size)
    }

    @Test
    fun `release package self events are filtered before enqueue`() = runTest {
        val manager = FakeRecordingManager(active = true)
        val filter =
            RecordingEventFilterDefault(
                recordingManager = manager,
                buildConfig = BuildConfigMock().apply { _debug = true },
            )
        val event =
            AccessibilityEvent.obtain(AccessibilityEvent.TYPE_VIEW_CLICKED).apply {
                packageName = "com.androperator.operator"
                className = "android.widget.Button"
            }

        filter.onAccessibilityEvent(TestAccessibilityService(context), event)

        assertEquals(0, manager.enqueuedEvents.size)
    }

    @Test
    fun `window change event is enqueued when recording is active`() = runTest {
        val manager = FakeRecordingManager(active = true)
        val filter =
            RecordingEventFilterDefault(
                recordingManager = manager,
                buildConfig = BuildConfigMock().apply { _debug = true },
            )
        val event =
            AccessibilityEvent.obtain(AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED).apply {
                packageName = "com.android.settings"
                className = "com.android.settings.Settings"
            }

        filter.onAccessibilityEvent(TestAccessibilityService(context), event)

        val recorded = assertIs<RecordingWindowChangeEvent>(manager.enqueuedEvents.single())
        assertEquals("com.android.settings", recorded.packageName)
        assertEquals(0L, recorded.seq)
    }

    @Test
    fun `click event is enqueued when recording is active`() = runTest {
        val manager = FakeRecordingManager(active = true)
        val filter =
            RecordingEventFilterDefault(
                recordingManager = manager,
                buildConfig = BuildConfigMock().apply { _debug = true },
            )
        val event =
            AccessibilityEvent.obtain(AccessibilityEvent.TYPE_VIEW_CLICKED).apply {
                packageName = "com.android.settings"
                className = "android.widget.Button"
                text.add("Display")
            }

        filter.onAccessibilityEvent(TestAccessibilityService(context), event)

        val recorded = assertIs<RecordingClickEvent>(manager.enqueuedEvents.single())
        assertEquals("com.android.settings", recorded.packageName)
        assertEquals(0L, recorded.seq)
        assertEquals("Display", recorded.text)
        assertEquals(null, recorded.snapshot)
    }

    @Test
    fun `non self scroll event is enqueued with null snapshot`() = runTest {
        val manager = FakeRecordingManager(active = true)
        val filter =
            RecordingEventFilterDefault(
                recordingManager = manager,
                buildConfig = BuildConfigMock().apply { _debug = true },
            )
        val event =
            AccessibilityEvent.obtain(AccessibilityEvent.TYPE_VIEW_SCROLLED).apply {
                packageName = "com.android.settings"
                scrollX = 1
                scrollY = 2
                maxScrollX = 3
                maxScrollY = 4
            }

        filter.onAccessibilityEvent(TestAccessibilityService(context), event)

        assertEquals(1, manager.enqueuedEvents.size)
        val recorded = manager.enqueuedEvents.single() as RecordingScrollEvent
        assertEquals("com.android.settings", recorded.packageName)
        assertEquals(null, recorded.snapshot)
        assertEquals(0L, recorded.seq)
        assertTrue(manager.isRecordingActive())
    }

    @Test
    fun `text change event is enqueued with null snapshot`() = runTest {
        val manager = FakeRecordingManager(active = true)
        val filter =
            RecordingEventFilterDefault(
                recordingManager = manager,
                buildConfig = BuildConfigMock().apply { _debug = true },
            )
        val event =
            AccessibilityEvent.obtain(AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED).apply {
                packageName = "com.android.settings"
                text.add("hello")
            }

        filter.onAccessibilityEvent(TestAccessibilityService(context), event)

        val recorded = assertIs<RecordingTextChangeEvent>(manager.enqueuedEvents.single())
        assertEquals("com.android.settings", recorded.packageName)
        assertEquals("hello", recorded.text)
        assertEquals(null, recorded.snapshot)
        assertEquals(0L, recorded.seq)
    }

    @Test
    fun `events are ignored when recording is not active`() = runTest {
        val manager = FakeRecordingManager(active = false)
        val filter =
            RecordingEventFilterDefault(
                recordingManager = manager,
                buildConfig = BuildConfigMock().apply { _debug = true },
            )
        val event =
            AccessibilityEvent.obtain(AccessibilityEvent.TYPE_VIEW_CLICKED).apply {
                packageName = "com.android.settings"
                text.add("Display")
            }

        filter.onAccessibilityEvent(TestAccessibilityService(context), event)

        assertEquals(0, manager.enqueuedEvents.size)
    }

    @Test
    fun `back key event is enqueued as press key when recording is active`() = runTest {
        val manager = FakeRecordingManager(active = true)
        val filter =
            RecordingEventFilterDefault(
                recordingManager = manager,
                buildConfig = BuildConfigMock().apply { _debug = true },
            )

        filter.onKeyEvent(
            TestAccessibilityService(context),
            KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_BACK),
        )

        // This unit test only verifies event routing. The real runtime capture path
        // snapshots the window before enqueueing the press_key event.
        val recorded = assertIs<RecordingPressKeyEvent>(manager.enqueuedEvents.single())
        assertEquals("back", recorded.key)
        assertEquals(0L, recorded.seq)
        assertEquals(null, recorded.snapshot)
    }

    private class FakeRecordingManager(
        private val active: Boolean,
    ) : RecordingManager, RecordingEventSink {
        val enqueuedEvents = mutableListOf<RecordingEvent>()
        private var nextSeq = 0L

        override suspend fun startRecording(sessionId: String?): RecordingCommandOutcome {
            error("unused in test")
        }

        override suspend fun stopRecording(sessionId: String?): RecordingCommandOutcome {
            error("unused in test")
        }

        override fun isRecordingActive(): Boolean = active

        override fun enqueueEvent(eventBuilder: (seq: Long) -> RecordingEvent): Boolean {
            enqueuedEvents += eventBuilder(nextSeq++)
            return true
        }
    }

    open class TestAccessibilityService(
        context: Context,
    ) : AccessibilityService() {
        private val baseContext = context

        override fun getSystemService(name: String): Any? = baseContext.getSystemService(name)

        override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        }

        override fun onInterrupt() {
        }
    }
}
