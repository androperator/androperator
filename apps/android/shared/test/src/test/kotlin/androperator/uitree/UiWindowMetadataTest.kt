package androperator.uitree

import android.view.accessibility.AccessibilityWindowInfo
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class UiWindowMetadataTest {
    @Test
    fun `window metadata keeps raw overlays while resolving exact owned overlay identity`() {
        val resolvedWindowIds = mutableListOf<Int>()
        val identity =
            object : OperatorOverlayIdentity {
                override val isOperatorOverlayVisible: Boolean = true

                override fun ownsOverlayWindow(window: OperatorOverlayWindowIdentity): Boolean {
                    if (window.title == "androperator.on_screen_log.7") {
                        resolvedWindowIds += window.id
                        return true
                    }
                    return false
                }
            }

        val metadata =
            buildUiWindowMetadata(
                foregroundPackage = "com.example.fixture",
                windows =
                    listOf(
                        UiWindowMetadataCandidate(
                            id = 1,
                            type = AccessibilityWindowInfo.TYPE_APPLICATION,
                            title = "Fixture",
                            packageName = "com.example.fixture",
                            isActive = true,
                        ),
                        UiWindowMetadataCandidate(
                            id = 2,
                            type = AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY,
                            title = "androperator.on_screen_log.7",
                            packageName = "com.androperator.operator.dev",
                            isActive = false,
                        ),
                        UiWindowMetadataCandidate(
                            id = 3,
                            type = AccessibilityWindowInfo.TYPE_ACCESSIBILITY_OVERLAY,
                            title = "other-overlay",
                            packageName = "com.example.otheroverlay",
                            isActive = false,
                        ),
                    ),
                operatorOverlayIdentity = identity,
            )

        assertTrue(metadata.hasOverlay)
        assertTrue(metadata.operatorOverlayVisible)
        assertEquals("com.androperator.operator.dev", metadata.overlayPackage)
        assertEquals(3, metadata.windowCount)
        assertEquals(listOf(2), resolvedWindowIds)
    }
}
