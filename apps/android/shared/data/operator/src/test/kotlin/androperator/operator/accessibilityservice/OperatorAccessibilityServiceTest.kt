package androperator.operator.accessibilityservice

import action.buildconfig.BuildConfigMock
import action.coroutine.CoroutineScopes
import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Application
import android.content.res.Configuration
import android.view.KeyEvent
import android.util.Log as AndroidLog
import android.view.accessibility.AccessibilityEvent
import androperator.accessibilityservice.AccessibilityServiceManagerAndroid
import androperator.operator.recording.RecordingEventFilter
import androperator.operator.onscreenlog.OnScreenLogPanelLifecycle
import androperator.operator.foreground.ForegroundApplicationObserver
import androperator.operator.foreground.ForegroundApplicationReader
import androperator.uitree.OperatorOverlayIdentityNone
import androperator.routine.RoutineId
import androperator.routine.RoutineManager
import androperator.routine.RoutineRun
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertSame
import kotlin.test.assertTrue
import org.junit.runner.RunWith
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin
import org.koin.dsl.module
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowAccessibilityService
import org.robolectric.shadows.ShadowLog
import timber.log.Timber
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, application = Application::class)
class OperatorAccessibilityServiceTest {
    // Lifecycle tests call onServiceConnected directly, without a system service connection.
    @Implements(AccessibilityService::class)
    class ConfiguredServiceShadow : ShadowAccessibilityService() {
        private var configuredServiceInfo: AccessibilityServiceInfo? = null

        @Implementation
        fun getServiceInfo(): AccessibilityServiceInfo? = configuredServiceInfo

        @Implementation
        fun setServiceInfo(info: AccessibilityServiceInfo) {
            configuredServiceInfo = info
        }
    }

    @Test
    fun `throwing diagnostic hook is swallowed by wrapper`() {
        runRecordingDiagnosticHook(
            hook = RecordingDiagnosticHook(),
            hookLabel = "for test",
        ) {
            throw IllegalStateException("boom")
        }
    }

    @Test
    fun `null diagnostic hook is a no-op`() {
        var invoked = false

        runRecordingDiagnosticHook(
            hook = null,
            hookLabel = "for test",
        ) {
            invoked = true
        }

        assertFalse(invoked)
    }

    @Test
    @Config(sdk = [33], manifest = Config.NONE, application = Application::class)
    fun `onCreateInputMethod returns custom accessibility ime on api33`() {
        withServiceKoin(debug = true) { _, _ ->
            val service = Robolectric.buildService(OperatorAccessibilityService::class.java).create().get()

            val inputMethod = service.onCreateInputMethod()

            assertTrue(inputMethod.javaClass.name.contains("OperatorAccessibilityInputMethod"))
        }
    }

    @Test
    @Config(sdk = [33, 34], manifest = Config.NONE, application = Application::class, shadows = [ConfiguredServiceShadow::class])
    fun `onServiceConnected owns panel lifecycle through service destruction`() {
        withServiceKoin(debug = true) { manager, panelLifecycle ->
            val service = Robolectric.buildService(OperatorAccessibilityService::class.java).create().get()
            service.serviceInfo = AccessibilityServiceInfo()

            ReflectionHelpers.callInstanceMethod<Unit>(service, "onServiceConnected")

            assertTrue((service.serviceInfo.flags and AccessibilityServiceInfo.FLAG_INPUT_METHOD_EDITOR) != 0)
            assertSame(service, manager.currentAccessibilityServiceFlow.value)
            assertSame(service, panelLifecycle.attachedService)
            assertTrue((service.serviceInfo.eventTypes and AccessibilityEvent.TYPE_WINDOWS_CHANGED) != 0)
            assertTrue((service.serviceInfo.flags and AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS) != 0)

            service.onConfigurationChanged(Configuration())
            assertEquals(1, panelLifecycle.configurationChanges)

            service.onDestroy()
            assertSame(null, manager.currentAccessibilityServiceFlow.value)
            assertEquals(1, panelLifecycle.detachCalls)
        }
    }

    @Test
    @Config(sdk = [32], manifest = Config.NONE, application = Application::class, shadows = [ConfiguredServiceShadow::class])
    fun `pre api33 service still loads and connects without ime editor flag`() {
        withServiceKoin(debug = true) { manager, _ ->
            val service = Robolectric.buildService(OperatorAccessibilityService::class.java).create().get()
            service.serviceInfo = AccessibilityServiceInfo()

            ReflectionHelpers.callInstanceMethod<Unit>(service, "onServiceConnected")

            assertTrue((service.serviceInfo.flags and AccessibilityServiceInfo.FLAG_INPUT_METHOD_EDITOR) == 0)
            assertSame(service, manager.currentAccessibilityServiceFlow.value)

            service.onDestroy()
            assertSame(null, manager.currentAccessibilityServiceFlow.value)
        }
    }

    @Test
    @Config(sdk = [33], manifest = Config.NONE, application = Application::class)
    fun `event bursts still reach recording without automatic verbose logging`() {
        for (debug in listOf(false, true)) {
            ShadowLog.clear()
            ShadowLog.setLoggable("RecordingDiag", AndroidLog.INFO)
            val logger = Timber.DebugTree()
            Timber.plant(logger)
            try {
                var delivered = 0
                val filter = object : RecordingEventFilter {
                    override fun onAccessibilityEvent(service: AccessibilityService, event: AccessibilityEvent?) {
                        assertEquals("SYNTHETIC_EVENT_PAYLOAD", event?.text?.single()?.toString())
                        delivered++
                    }
                    override fun onKeyEvent(service: AccessibilityService, event: KeyEvent) = Unit
                }
                withServiceKoin(debug, eventFilter = filter) { _, _ ->
                    val service = Robolectric.buildService(OperatorAccessibilityService::class.java).create().get()
                    repeat(1000) { index ->
                        val type = if (index % 2 == 0) AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
                            else AccessibilityEvent.TYPE_VIEW_SCROLLED
                        val event = AccessibilityEvent.obtain(type).apply {
                            packageName = "com.example.fixture"
                            text.add("SYNTHETIC_EVENT_PAYLOAD")
                        }
                        service.onAccessibilityEvent(event)
                    }
                    assertEquals(1000, delivered)
                    assertTrue(ShadowLog.getLogs().none {
                        it.tag == "RecordingDiag" || it.msg.contains("SYNTHETIC_EVENT_PAYLOAD")
                    }, "Ordinary event delivery must not flood the shared canonical-result logger")
                }
            } finally {
                Timber.uproot(logger)
            }
        }
    }

    @Test
    @Config(sdk = [33], manifest = Config.NONE, application = Application::class)
    fun `explicit verbose recording diagnostics retain full event detail only in debug builds`() {
        try {
            for (debug in listOf(false, true)) {
                ShadowLog.clear()
                ShadowLog.setLoggable("RecordingDiag", AndroidLog.INFO)
                val logger = Timber.DebugTree()
                Timber.plant(logger)
                try {
                    var delivered = 0
                    val filter = object : RecordingEventFilter {
                        override fun onAccessibilityEvent(service: AccessibilityService, event: AccessibilityEvent?) {
                            delivered++
                        }
                        override fun onKeyEvent(service: AccessibilityService, event: KeyEvent) = Unit
                    }
                    withServiceKoin(debug, eventFilter = filter) { _, _ ->
                        val service = Robolectric.buildService(OperatorAccessibilityService::class.java).create().get()
                        val event = AccessibilityEvent.obtain(AccessibilityEvent.TYPE_VIEW_SCROLLED).apply {
                            packageName = "com.example.fixture"
                            text.add("SYNTHETIC_EVENT_PAYLOAD")
                        }
                        service.onAccessibilityEvent(event)
                        assertEquals(1, delivered)
                        assertTrue(ShadowLog.getLogs().none { it.tag == "RecordingDiag" || it.msg.contains("SYNTHETIC_EVENT_PAYLOAD") })

                        ShadowLog.setLoggable("RecordingDiag", AndroidLog.VERBOSE)
                        service.onAccessibilityEvent(event)
                        assertEquals(2, delivered)
                        assertEquals(debug, ShadowLog.getLogs().any {
                            it.tag == "RecordingDiag" && it.msg.startsWith("HANDLER type=TYPE_VIEW_SCROLLED")
                        })
                        assertEquals(debug, ShadowLog.getLogs().any { it.msg.contains("SYNTHETIC_EVENT_PAYLOAD") })

                        ShadowLog.setLoggable("RecordingDiag", AndroidLog.INFO)
                        ShadowLog.clear()
                        service.onAccessibilityEvent(event)
                        assertEquals(3, delivered)
                        assertTrue(ShadowLog.getLogs().none { it.tag == "RecordingDiag" || it.msg.contains("SYNTHETIC_EVENT_PAYLOAD") })
                    }
                } finally {
                    Timber.uproot(logger)
                }
            }
        } finally {
            ShadowLog.setLoggable("RecordingDiag", AndroidLog.INFO)
        }
    }

    private fun withServiceKoin(
        debug: Boolean,
        eventFilter: RecordingEventFilter = NoOpRecordingEventFilter(),
        block: (AccessibilityServiceManagerAndroid, RecordingOnScreenLogPanelLifecycle) -> Unit,
    ) {
        stopKoin()

        val manager = AccessibilityServiceManagerAndroid()
        val buildConfig = BuildConfigMock().apply { _debug = debug }
        val coroutineScopes =
            CoroutineScopes(
                main = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined),
                io = CoroutineScope(SupervisorJob() + Dispatchers.Unconfined),
            )
        val routineManager = NoOpRoutineManager()
        val panelLifecycle = RecordingOnScreenLogPanelLifecycle()

        try {
            startKoin {
                modules(
                    module {
                        single { manager }
                        single { ForegroundApplicationObserver(ForegroundApplicationReader(OperatorOverlayIdentityNone)) }
                        single<action.buildconfig.BuildConfig> { buildConfig }
                        single { coroutineScopes }
                        single<RoutineManager> { routineManager }
                        single<RecordingEventFilter> { eventFilter }
                        single<OnScreenLogPanelLifecycle> { panelLifecycle }
                    },
                )
            }
            block(manager, panelLifecycle)
        } finally {
            stopKoin()
        }
    }

    private class NoOpRoutineManager : RoutineManager {
        override val isRunning: Boolean = false

        override suspend fun runLoop() = Unit

        override fun start(build: () -> RoutineRun): RoutineId = RoutineId("test")

        override fun cancelCurrent(): Boolean = false
    }

    private class NoOpRecordingEventFilter : RecordingEventFilter {
        override fun onAccessibilityEvent(
            service: AccessibilityService,
            event: AccessibilityEvent?,
        ) = Unit

        override fun onKeyEvent(
            service: AccessibilityService,
            event: KeyEvent,
        ) = Unit
    }

    private class RecordingOnScreenLogPanelLifecycle : OnScreenLogPanelLifecycle {
        var attachedService: AccessibilityService? = null
        var detachCalls = 0
        var configurationChanges = 0

        override fun attach(service: AccessibilityService) {
            attachedService = service
        }

        override fun detach() {
            detachCalls += 1
            attachedService = null
        }

        override fun onConfigurationChanged() {
            configurationChanges += 1
        }
    }
}
