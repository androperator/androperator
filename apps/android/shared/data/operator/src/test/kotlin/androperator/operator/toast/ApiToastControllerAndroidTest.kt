package androperator.operator.toast

import android.widget.Toast
import kotlinx.coroutines.runBlocking
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowToast
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class ApiToastControllerAndroidTest {
    @Test
    fun `replacement and cancellation own only API toasts and use native durations`() = runBlocking {
        val context = RuntimeEnvironment.getApplication()
        val controller = ApiToastControllerAndroid(context)
        val incidental = Toast.makeText(context, "Internal message", Toast.LENGTH_SHORT)
        incidental.show()
        controller.cancel()
        assertFalse(shadowOf(incidental).isCancelled)

        controller.show("Starting test run", "long")
        val first = ShadowToast.getLatestToast()
        assertEquals("Starting test run", ShadowToast.getTextOfLatestToast())
        assertEquals(Toast.LENGTH_LONG, first.duration)
        assertFalse(shadowOf(incidental).isCancelled)

        controller.show("Replacement", "short")
        val second = ShadowToast.getLatestToast()
        assertTrue(shadowOf(first).isCancelled)
        assertEquals(Toast.LENGTH_SHORT, second.duration)
        assertEquals("Replacement", ShadowToast.getTextOfLatestToast())

        controller.cancel()
        controller.cancel()
        assertTrue(shadowOf(second).isCancelled)
        assertFalse(shadowOf(incidental).isCancelled)
        controller.show("Next run", "short")
        assertEquals("Next run", ShadowToast.getTextOfLatestToast())
        assertFalse(shadowOf(ShadowToast.getLatestToast()).isCancelled)
    }
}
