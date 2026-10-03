package androperator.accessibilityservice

import action.log.Log
import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.RectF
import android.os.Build
import androidx.annotation.RequiresApi

@RequiresApi(Build.VERSION_CODES.S)
fun AccessibilityService.closeNotificationPanel() {
    performGlobalAction(
        AccessibilityService.GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE,
    )
}

/**
 * Opens the Recent Apps (Recents) screen using Android's Accessibility APIs.
 *
 * This function performs the global action `GLOBAL_ACTION_RECENTS` which brings up
 * the overview screen showing recently used applications. This is equivalent to
 * pressing the Recents button on Android devices.
 *
 * **Requirements:**
 * - Android API level 24+ (Android 7.0 Nougat) or higher
 * - Accessibility Service must be running and enabled
 *
 * **Usage:**
 * This is typically called before attempting to close apps, as it provides
 * access to the app cards that can be swiped away to close applications.
 *
 * **Note:**
 * The exact behavior may vary between different Android versions and OEM skins.
 * Some manufacturers customize the Recents screen appearance and functionality.
 */
@RequiresApi(Build.VERSION_CODES.N)
fun AccessibilityService.openRecentApps() {
    performGlobalAction(
        AccessibilityService.GLOBAL_ACTION_RECENTS,
    )
}

@RequiresApi(Build.VERSION_CODES.S)
fun AccessibilityService.openQuickSettings() {
    performGlobalAction(
        AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS,
    )
}

/**
 * Tap at the center of given bounds using gesture injection
 */
fun AccessibilityService.tapCenterOf(
    bounds: RectF,
    onDone: (() -> Unit)? = null,
    gestureStartTime: Long = 0L,
    tapDurationMs: Long = 50L,
    minTapSize: Float = 10f,
    tapPadding: Float = 5f,
) {
    try {
        // Ensure bounds are reasonable for a tap (at least minTapSize pixels)
        val tapBounds =
            if (bounds.width() < minTapSize || bounds.height() < minTapSize) {
                RectF(
                    bounds.centerX() - tapPadding,
                    bounds.centerY() - tapPadding,
                    bounds.centerX() + tapPadding,
                    bounds.centerY() + tapPadding,
                )
            } else {
                bounds
            }

        val path =
            Path().apply {
                moveTo(tapBounds.centerX(), tapBounds.centerY())
            }

        // Use configured duration for tap gestures
        val stroke = GestureDescription.StrokeDescription(path, gestureStartTime, tapDurationMs)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()

        Log.d("[Operator-AccessibilityService] Dispatching tap gesture at (${tapBounds.centerX()}, ${tapBounds.centerY()}) with bounds ${tapBounds.width()}x${tapBounds.height()}")

        val result =
            dispatchGesture(
                gesture,
                object : AccessibilityService.GestureResultCallback() {
                    override fun onCompleted(gestureDescription: GestureDescription?) {
                        Log.d("[Operator-AccessibilityService] ✅ Gesture tap completed successfully at (${tapBounds.centerX()}, ${tapBounds.centerY()})")
                        onDone?.invoke()
                    }

                    override fun onCancelled(gestureDescription: GestureDescription?) {
                        Log.w("[Operator-AccessibilityService] ❌ Gesture tap cancelled at (${tapBounds.centerX()}, ${tapBounds.centerY()})")
                    }
                },
                null,
            )

        if (!result) {
            Log.e("[Operator-AccessibilityService] ❌ Failed to dispatch gesture - dispatchGesture returned false")
        }
    } catch (e: Exception) {
        Log.e("[Operator-AccessibilityService] ❌ Error dispatching tap gesture: ${e.message}")
    }
}
