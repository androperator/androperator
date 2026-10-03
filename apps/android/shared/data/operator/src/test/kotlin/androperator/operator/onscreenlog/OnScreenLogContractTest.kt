package androperator.operator.onscreenlog

import androperator.task.runner.OnScreenLogAnchor
import androperator.task.runner.OnScreenLogBounds
import androperator.task.runner.OnScreenLogContract
import androperator.task.runner.OnScreenLogGeometry
import androperator.task.runner.OnScreenLogLayoutException
import androperator.task.runner.OnScreenLogSpec
import androperator.task.runner.OnScreenLogTextAlign
import androperator.task.runner.OnScreenLogValidationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class OnScreenLogContractTest {
    @Test
    fun `normalization preserves multiline text and canonicalizes colors`() {
        val normalized =
            OnScreenLogContract.normalize(
                OnScreenLogSpec(
                    text = "FLOW-001\nObserve settings\tready",
                    textColor = "#112233",
                    backgroundColor = "#aa445566",
                ),
            )

        assertEquals("FLOW-001\nObserve settings\tready", normalized.text)
        assertEquals("#FF112233", normalized.textColor)
        assertEquals("#AA445566", normalized.backgroundColor)
    }

    @Test
    fun `validation rejects blank text controls and malformed colors`() {
        assertFailsWith<OnScreenLogValidationException> {
            OnScreenLogContract.normalize(OnScreenLogSpec(text = "\n\t "))
        }
        assertFailsWith<OnScreenLogValidationException> {
            OnScreenLogContract.normalize(OnScreenLogSpec(text = "\uFEFF"))
        }
        assertFailsWith<OnScreenLogValidationException> {
            OnScreenLogContract.normalize(OnScreenLogSpec(text = "valid\u0000text"))
        }
        assertFailsWith<OnScreenLogValidationException> {
            OnScreenLogContract.normalize(OnScreenLogSpec(text = "valid", textColor = "red"))
        }
    }

    @Test
    fun `geometry uses physical anchors and exact usable bounds`() {
        val normalized =
            OnScreenLogContract.normalize(
                OnScreenLogSpec(
                    text = "label",
                    anchor = OnScreenLogAnchor.Right,
                    textAlign = OnScreenLogTextAlign.Left,
                    edgeOffsetDp = 10,
                    topOffsetDp = 20,
                    widthDp = 100,
                ),
            )
        val geometry =
            OnScreenLogGeometry.resolve(
                spec = normalized,
                density = 2f,
                scaledDensity = 1.5f,
                usableBounds = OnScreenLogBounds(20, 40, 620, 1_040),
                completeTextLineHeightPx = 24,
            )

        assertEquals(400, geometry.bounds.left)
        assertEquals(600, geometry.bounds.right)
        assertEquals(80, geometry.bounds.top)
        assertEquals(960, geometry.maxHeightPx)
        assertEquals(16, geometry.paddingPx)
        assertEquals(18f, geometry.fontSizePx)
    }

    @Test
    fun `geometry rejects horizontal and vertical overflow without repositioning`() {
        val normalized = OnScreenLogContract.normalize(OnScreenLogSpec(text = "label", widthDp = 600))

        assertFailsWith<OnScreenLogLayoutException> {
            OnScreenLogGeometry.resolve(
                spec = normalized,
                density = 1f,
                scaledDensity = 1f,
                usableBounds = OnScreenLogBounds(0, 0, 500, 1_000),
                completeTextLineHeightPx = 16,
            )
        }
        assertFailsWith<OnScreenLogLayoutException> {
            OnScreenLogGeometry.resolve(
                spec = normalized.copy(widthDp = 80, topOffsetDp = 990),
                density = 1f,
                scaledDensity = 1f,
                usableBounds = OnScreenLogBounds(0, 0, 500, 1_000),
                completeTextLineHeightPx = 16,
            )
        }
    }
}
