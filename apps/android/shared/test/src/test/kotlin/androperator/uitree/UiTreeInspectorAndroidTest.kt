package androperator.uitree

import android.accessibilityservice.AccessibilityService
import android.app.Application
import android.content.Context
import android.os.Build
import android.view.WindowManager
import androidx.test.core.app.ApplicationProvider
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, application = Application::class)
class UiTreeInspectorAndroidTest {

    private val context = ApplicationProvider.getApplicationContext<Context>()

    open class TestAccessibilityService(context: Context) : AccessibilityService() {
        private val baseContext = context
        override fun getSystemService(name: String): Any? = baseContext.getSystemService(name)
        override fun onAccessibilityEvent(event: android.view.accessibility.AccessibilityEvent?) {}
        override fun onInterrupt() {}
    }

    @Test
    @Config(sdk = [Build.VERSION_CODES.Q])
    fun `window diagnostics preserve zero and unknown without selecting a root`() = kotlinx.coroutines.runBlocking {
        var unavailable = false
        val service = object : TestAccessibilityService(context) {
            override fun getWindows(): List<android.view.accessibility.AccessibilityWindowInfo> {
                if (unavailable) throw IllegalStateException("Window access unavailable")
                return emptyList()
            }
        }
        val manager = androperator.accessibilityservice.AccessibilityServiceManagerAndroid()
        manager.setCurrentAccessibilityService(service, true)
        val inspector = UiTreeInspectorAndroid(manager)
        assertEquals(UiHierarchyDiagnostics(serviceAvailable = true, windowCount = 0), inspector.getUnavailableHierarchyDiagnostics())
        unavailable = true
        assertEquals(UiHierarchyDiagnostics(serviceAvailable = true), inspector.getUnavailableHierarchyDiagnostics())
    }

    @Test
    @Config(sdk = [Build.VERSION_CODES.Q])
    fun `unavailable service diagnostics distinguish absence from unknown windows`() = kotlinx.coroutines.runBlocking {
        val inspector = UiTreeInspectorAndroid(androperator.accessibilityservice.AccessibilityServiceManagerAndroid())
        assertEquals(null, inspector.getCurrentUiTree())
        assertEquals(UiHierarchyDiagnostics(serviceAvailable = false), inspector.getUnavailableHierarchyDiagnostics())
    }

    @Test
    @Config(sdk = [Build.VERSION_CODES.R])
    fun `getScreenDimensionsFromService returns dimensions using WindowMetrics on API 30+`() {
        val service = TestAccessibilityService(context)
        
        val (width, height) = UiTreeInspectorAndroid.getScreenDimensionsFromService(service)
        
        assertTrue(width > 0)
        assertTrue(height > 0)
    }

    @Test
    @Config(sdk = [Build.VERSION_CODES.Q])
    fun `getScreenDimensionsFromService returns dimensions using DisplayMetrics on pre-API 30`() {
        val service = TestAccessibilityService(context)
        
        val (width, height) = UiTreeInspectorAndroid.getScreenDimensionsFromService(service)
        
        assertTrue(width > 0)
        assertTrue(height > 0)
    }

    @Test
    @Config(sdk = [Build.VERSION_CODES.Q])
    fun `getScreenDimensionsFromService returns 0 0 when WindowManager unavailable`() {
        val service = object : TestAccessibilityService(context) {
            override fun getSystemService(name: String): Any? {
                if (name == Context.WINDOW_SERVICE) return null
                return super.getSystemService(name)
            }
        }
        
        val (width, height) = UiTreeInspectorAndroid.getScreenDimensionsFromService(service)
        assertEquals(0, width)
        assertEquals(0, height)
    }
}
