package androperator.operator.onscreenlog

import android.accessibilityservice.AccessibilityService
import android.app.Application
import android.content.Intent
import android.net.Uri
import android.text.Spanned
import android.text.style.ImageSpan
import android.view.accessibility.AccessibilityEvent
import androperator.operator.foreground.ForegroundApplicationObserver
import androperator.operator.foreground.ForegroundApplicationState
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.withContext
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, application = Application::class, sdk = [34])
@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
class OnScreenLogTemplateSessionTest {
    class Service : AccessibilityService() {
        override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit
        override fun onInterrupt() = Unit
    }

    @Test
    fun `device templates never request an observer and render literal escapes`() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        val service = Robolectric.buildService(Service::class.java).create().get()
        var subscriptions = 0
        val session = OnScreenLogTemplateSession(service, "{{device.model}} {{{{foreground_app.icon}}}}", { subscriptions++; error("unused") }, 12, {}, { error("failed") })
        try {
            assertTrue(session.initial().text.toString().endsWith("{{foreground_app.icon}}"))
            session.start()
            runCurrent()
            assertEquals(0, subscriptions)
        } finally {
            session.close()
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `late lookup cannot publish after focus change or close and package updates invalidate cache`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        val service = Robolectric.buildService(Service::class.java).create().get()
        var focused = "example.first"
        val observer = ForegroundApplicationObserver(backgroundScope) { _, _ -> ForegroundApplicationState.Available(focused, 0) }
        observer.attach(service)
        val firstResult = CompletableDeferred<Unit>()
        var reads = 0
        val rendered = mutableListOf<String>()
        val session = OnScreenLogTemplateSession(service,
            "{{foreground_app.package_name}} {{foreground_app.version_code}} {{foreground_app.version_name}}",
            { observer }, 12, { rendered.add(it.text.toString()) }, { error("failed") }, dispatcher,
            lookup = { name ->
                reads++
                if (name == "example.first") withContext(NonCancellable) { firstResult.await() }
                OnScreenLogAppMetadata(name, "4294967297", "{{device.model}}-$reads")
            })
        try {
            session.start()
            runCurrent()
            focused = "example.second"
            observer.onAccessibilityEvent(service, AccessibilityEvent.obtain(AccessibilityEvent.TYPE_WINDOWS_CHANGED))
            runCurrent()
            assertEquals("example.second Unavailable Unavailable", rendered.last())
            firstResult.complete(Unit)
            runCurrent()
            assertFalse(rendered.any { it.startsWith("example.first 4294967297") })
            assertTrue(rendered.last().startsWith("example.second 4294967297 {{device.model}}"), rendered.toString())
            val previousReads = reads
            service.sendBroadcast(Intent(Intent.ACTION_PACKAGE_REPLACED, Uri.parse("package:example.second")))
            shadowOf(android.os.Looper.getMainLooper()).idle()
            runCurrent()
            assertEquals(previousReads + 1, reads)
            val beforeClose = rendered.size
            session.close()
            session.refresh()
            observer.onAccessibilityEvent(service, AccessibilityEvent.obtain(AccessibilityEvent.TYPE_WINDOWS_CHANGED))
            runCurrent()
            assertEquals(beforeClose, rendered.size)
        } finally {
            session.close()
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `close cancels pending metadata even when lookup ignores cancellation`() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        val service = Robolectric.buildService(Service::class.java).create().get()
        val observer = ForegroundApplicationObserver(backgroundScope) { _, _ -> ForegroundApplicationState.Available("example.app", 0) }
        observer.attach(service)
        val gate = CompletableDeferred<Unit>()
        var started = false
        val rendered = mutableListOf<String>()
        val session = OnScreenLogTemplateSession(service, "{{foreground_app.version_name}}", { observer }, 12,
            { rendered.add(it.text.toString()) }, { error("failed") }, dispatcher,
            lookup = { name ->
                started = true
                withContext(NonCancellable) { gate.await() }
                OnScreenLogAppMetadata(name, versionName = "must not publish")
            })
        try {
            session.start()
            runCurrent()
            assertTrue(started)
            session.close()
            val count = rendered.size
            gate.complete(Unit)
            runCurrent()
            assertEquals(count, rendered.size)
            assertFalse(rendered.contains("must not publish"))
            assertFalse(observer.isObserving)
        } finally {
            gate.complete(Unit)
            session.close()
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `expansion caps total content and preserves known package when metadata is missing`() {
        val service = Robolectric.buildService(Service::class.java).create().get()
        val session = OnScreenLogTemplateSession(service, "{{foreground_app.version_name}}".repeat(60), { error("unused") }, 12, {}, {})
        val content = session.render(OnScreenLogAppMetadata("example.app", versionName = "a".repeat(500)))
        assertTrue(content.truncated)
        assertEquals(8192, content.text.length)
        assertTrue(content.text.endsWith("…"))
        session.close()
        val missing = OnScreenLogTemplateSession.loadMetadata(service, "example.not.installed")
        assertEquals("example.not.installed", missing.packageName)
        assertEquals("Unavailable", missing.versionName)
        assertEquals("Unavailable", missing.versionCode)
        assertEquals(null, missing.icon)
    }

    @Test
    fun `unavailable icon is inline and expansion is bounded without splitting surrogates`() {
        val service = Robolectric.buildService(Service::class.java).create().get()
        val session = OnScreenLogTemplateSession(service, "{{foreground_app.icon}} {{foreground_app.version_name}}", { error("unused") }, 12, {}, {})
        val initial = session.initial().text as Spanned
        assertEquals(1, initial.getSpans(0, initial.length, ImageSpan::class.java).size)
        assertTrue(initial.toString().endsWith("Unavailable"))
        assertEquals("a", OnScreenLogTemplateSession.safePrefix("a😀", 2))
        assertEquals(256, OnScreenLogTemplateSession.boundedValue("x".repeat(500)).length)
        assertEquals("a b", OnScreenLogTemplateSession.boundedValue("a\nb"))
        session.close()
    }
}
