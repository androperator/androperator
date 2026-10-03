package androperator.operator.onscreenlog

import android.app.Application
import android.os.Build
import android.text.Layout
import androidx.test.core.app.ApplicationProvider
import androperator.task.runner.OnScreenLogBounds
import androperator.task.runner.OnScreenLogContract
import androperator.task.runner.OnScreenLogPanelGeometry
import androperator.task.runner.OnScreenLogSpec
import androperator.task.runner.OnScreenLogTextAlign
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, application = Application::class)
class OnScreenLogPanelViewTest {
    @Test
    @Config(sdk = [Build.VERSION_CODES.LOLLIPOP_MR1])
    fun `api 22 uses physical text alignment for right to left text`() {
        val view = OnScreenLogPanelView(ApplicationProvider.getApplicationContext())
        val left =
            view.prepare(
                OnScreenLogContract.normalize(
                    OnScreenLogSpec(
                        text = "مرحبا",
                        textAlign = OnScreenLogTextAlign.Left,
                    ),
                ),
                geometry(widthPx = 200, maxHeightPx = 100),
            )
        val right =
            view.prepare(
                OnScreenLogContract.normalize(
                    OnScreenLogSpec(
                        text = "مرحبا",
                        textAlign = OnScreenLogTextAlign.Right,
                    ),
                ),
                geometry(widthPx = 200, maxHeightPx = 100),
            )

        assertEquals(Layout.DIR_LEFT_TO_RIGHT, left.textLayout.getParagraphDirection(0))
        assertEquals(Layout.DIR_LEFT_TO_RIGHT, right.textLayout.getParagraphDirection(0))
        assertTrue(right.textLayout.getLineLeft(0) > left.textLayout.getLineLeft(0))
    }

    @Test
    @Config(sdk = [Build.VERSION_CODES.P])
    fun `overflow ellipsizes the final complete visible line`() {
        val view = OnScreenLogPanelView(ApplicationProvider.getApplicationContext())
        val spec =
            OnScreenLogContract.normalize(
                OnScreenLogSpec(text = "first line\nsecond line\nthird line"),
            )
        val maxHeightPx = view.completeTextLineHeightPx(spec, scaledDensity = 1f) + 16
        val prepared =
            view.prepare(
                spec,
                geometry(widthPx = 200, maxHeightPx = maxHeightPx),
            )

        assertTrue(prepared.truncated)
        assertEquals(1, prepared.textLayout.lineCount)
        assertTrue(prepared.textLayout.getEllipsisCount(0) > 0)
        assertTrue(prepared.heightPx <= maxHeightPx)
    }

    private fun geometry(
        widthPx: Int,
        maxHeightPx: Int,
    ): OnScreenLogPanelGeometry =
        OnScreenLogPanelGeometry(
            bounds = OnScreenLogBounds(0, 0, widthPx, maxHeightPx),
            maxHeightPx = maxHeightPx,
            paddingPx = 8,
            fontSizePx = 12f,
        )
}
