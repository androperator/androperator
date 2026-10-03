package androperator.operator.accessibilityservice

import action.buildconfig.BuildConfigMock
import action.coroutine.CoroutineScopes
import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.Application
import android.content.res.Configuration
import android.view.KeyEvent
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

    private fun withServiceKoin(
        debug: Boolean,
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
        val recordingEventFilter = NoOpRecordingEventFilter()
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
                        single<RecordingEventFilter> { recordingEventFilter }
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
