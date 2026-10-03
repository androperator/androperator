package androperator.accessibilityservice

import action.log.Log
import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import kotlinx.coroutines.delay

private const val TAG = "AccessibilityGestures"

/**
 * Attempts to close the first app in Recents using a series of gesture strategies.
 *
 * This function implements a progressive fallback approach to handle different Android device behaviors:
 * 1. First tries a swipe from the right edge (handles Samsung devices where current app appears on right edge)
 * 2. Then tries a standard center swipe (handles most other devices and covers previously opened apps)
 *
 * On some Android devices (like Samsung), when Recents is opened, the current app appears
 * on the right edge of the screen rather than center. This dual-strategy approach ensures
 * we close the intended app regardless of device-specific Recents layout behavior.
 *
 * @param screenWidth Width of the device screen in pixels
 * @param screenHeight Height of the device screen in pixels
 * @return true if any gesture strategy succeeded, false otherwise
 */
suspend fun AccessibilityService.tryGenericAppCloseGestures(
    screenWidth: Int,
    screenHeight: Int,
): Boolean {
    Log.d("$TAG 🔄 Attempting generic app close gestures with dual-strategy approach")

    return try {
        // Strategy 1: Right edge swipe (handles Samsung devices where current app appears on right edge)
        val rightEdgeResult = performRightEdgeSwipeUp(screenWidth, screenHeight)
        if (rightEdgeResult) {
            Log.d("$TAG ✅ Right edge swipe succeeded")
        } else {
            Log.d("$TAG ⚠️ Right edge swipe failed")
        }

        // Strategy 2: Standard center swipe (handles most other devices and covers previously opened apps)
        val centerResult = tryGenericAppCloseGesturesCenter(screenWidth = screenWidth, screenHeight = screenHeight)
        if (centerResult) {
            Log.d("$TAG ✅ Center swipe succeeded")
        } else {
            Log.d("$TAG ⚠️ Center edge swipe failed")
        }

        // Note: we intentionally always try both strategies to maximize success rate
        return rightEdgeResult || centerResult
    } catch (e: Exception) {
        Log.e("$TAG ❌ Error in gesture strategies: ${e.message}")
        // Strategy 3: Simple fallback (if both strategies threw exceptions)
        trySimpleCenterSwipe(screenWidth, screenHeight)
    }
}

private suspend fun AccessibilityService.tryGenericAppCloseGesturesCenter(
    screenWidth: Int,
    screenHeight: Int,
): Boolean {
    Log.d("$TAG 🔄 Attempting generic app close gestures with progressive fallback strategy")

    return try {
        // Strategy 1: Standard center swipe (optimized for Samsung One UI)
        val firstTry = performCenterTapHoldSwipeUp(screenWidth, screenHeight)
        if (firstTry) return true

        // Strategy 2: Aggressive flick for Pixel devices (if Strategy 1 failed)
        Log.d("$TAG 🔄 Strategy 1 failed, trying aggressive flick for Pixel compatibility")
        performAggressiveCenterFlick(screenWidth, screenHeight)
    } catch (e: Exception) {
        Log.e("$TAG ❌ Error in gesture strategies: ${e.message}")
        // Strategy 3: Simple fallback (if both strategies threw exceptions)
        trySimpleCenterSwipe(screenWidth, screenHeight)
    }
}

/**
 * Performs a right edge swipe gesture for devices where the current app appears on the right edge in Recents.
 *
 * This gesture starts from near the right edge (95% of screen width) and swipes upward to 10% of screen height.
 * Used specifically for Samsung devices and other Android versions where the current app card
 * appears on the right edge rather than center in the Recents view.
 *
 * The duration is dynamically calculated based on swipe distance for optimal recognition:
 * - Longer swipes (>800px) use 250ms duration for better velocity
 * - Shorter swipes use 300ms duration for reliability
 *
 * @param screenWidth Width of the device screen in pixels
 * @param screenHeight Height of the device screen in pixels
 * @return true if the gesture was dispatched successfully, false otherwise
 */
suspend fun AccessibilityService.performRightEdgeSwipeUp(
    screenWidth: Int,
    screenHeight: Int,
): Boolean =
    try {
        val rightEdgeX = screenWidth * 0.95f // Start from 95% of screen width (5% from right edge)
        val startY = screenHeight / 2f // Start from screen center vertically
        val endY = screenHeight * 0.1f // End at 10% from top

        Log.d("$TAG 🎯 Right edge swipe: (${rightEdgeX.toInt()}, ${startY.toInt()}) -> (${rightEdgeX.toInt()}, ${endY.toInt()})")

        // Dynamic duration based on swipe distance for optimal gesture recognition
        val distance = startY - endY
        val duration = if (distance > 800f) 250L else 300L // Faster for longer distances

        executeSwipeGesture(rightEdgeX, startY, rightEdgeX, endY, duration)
    } catch (e: Exception) {
        Log.e("$TAG ❌ Error in right edge swipe: ${e.message}")
        false
    }

/**
 * Performs a center swipe gesture optimized for Samsung One UI devices.
 *
 * This gesture starts from the screen center and swipes upward to 10% of screen height.
 * The duration is dynamically calculated based on swipe distance for optimal recognition:
 * - Longer swipes (>800px) use 250ms duration for better velocity
 * - Shorter swipes use 300ms duration for reliability
 *
 * @param screenWidth Width of the device screen in pixels
 * @param screenHeight Height of the device screen in pixels
 * @return true if the gesture was dispatched successfully, false otherwise
 */
suspend fun AccessibilityService.performCenterTapHoldSwipeUp(
    screenWidth: Int,
    screenHeight: Int,
): Boolean =
    try {
        val centerX = screenWidth / 2f
        val startY = screenHeight / 2f // Start from screen center
        val endY = screenHeight * 0.1f // End at 10% from top

        Log.d("$TAG 🎯 Samsung-optimized center swipe: (${centerX.toInt()}, ${startY.toInt()}) -> (${centerX.toInt()}, ${endY.toInt()})")

        // Dynamic duration based on swipe distance for optimal gesture recognition
        val distance = startY - endY
        val duration = if (distance > 800f) 250L else 300L // Faster for longer distances

        executeSwipeGesture(centerX, startY, centerX, endY, duration)
    } catch (e: Exception) {
        Log.e("$TAG ❌ Error in Samsung-optimized center swipe: ${e.message}")
        false
    }

/**
 * Performs an aggressive center flick gesture optimized for Google Pixel devices.
 *
 * This gesture uses a very fast 200ms duration and extends to only 5% from the top
 * (compared to 10% for the standard gesture). The combination of high speed and
 * longer distance creates a more pronounced "flick" motion that Pixel devices
 * seem to require for reliable gesture recognition.
 *
 * @param screenWidth Width of the device screen in pixels
 * @param screenHeight Height of the device screen in pixels
 * @return true if the gesture was dispatched successfully, false otherwise
 */
private suspend fun AccessibilityService.performAggressiveCenterFlick(
    screenWidth: Int,
    screenHeight: Int,
): Boolean =
    try {
        val centerX = screenWidth / 2f
        val startY = screenHeight / 2f
        val endY = screenHeight * 0.05f // Extended distance (5% from top) for more aggressive flick

        Log.d("$TAG 🔥 Pixel-optimized aggressive flick: (${centerX.toInt()}, ${startY.toInt()}) -> (${centerX.toInt()}, ${endY.toInt()})")

        // Very fast duration (200ms) combined with longer distance creates aggressive flick
        executeSwipeGesture(centerX, startY, centerX, endY, 200L)
    } catch (e: Exception) {
        Log.e("$TAG ❌ Error in Pixel-optimized aggressive flick: ${e.message}")
        false
    }

/**
 * Low-level function to execute a swipe gesture using Android's Accessibility APIs.
 *
 * Creates a Path from start coordinates to end coordinates and builds a GestureDescription
 * with the specified duration. The gesture is dispatched asynchronously and this function
 * waits for the gesture duration plus a small buffer to ensure completion.
 *
 * @param startX Starting X coordinate in pixels
 * @param startY Starting Y coordinate in pixels
 * @param endX Ending X coordinate in pixels
 * @param endY Ending Y coordinate in pixels
 * @param durationMs Duration of the gesture in milliseconds
 * @return true if the gesture was dispatched successfully, false otherwise
 */
private suspend fun AccessibilityService.executeSwipeGesture(
    startX: Float,
    startY: Float,
    endX: Float,
    endY: Float,
    durationMs: Long,
): Boolean =
    try {
        // Create a straight-line path from start to end coordinates
        val path =
            Path().apply {
                moveTo(startX, startY)
                lineTo(endX, endY)
            }

        // Build gesture description with the path and duration
        val stroke = GestureDescription.StrokeDescription(path, 0L, durationMs)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()

        // Dispatch the gesture (returns immediately, gesture executes asynchronously)
        val result = dispatchGesture(gesture, null, null)
        if (result) {
            // Wait for gesture completion plus buffer to ensure UI has time to respond
            delay(durationMs + 100)
            Log.d("$TAG ✅ Swipe gesture dispatched successfully")
        } else {
            Log.e("$TAG ❌ Failed to dispatch swipe gesture")
        }
        result
    } catch (e: Exception) {
        Log.e("$TAG ❌ Error executing swipe gesture: ${e.message}")
        false
    }

/**
 * Last-resort fallback gesture for when all other strategies fail.
 *
 * This function performs a simple center-to-top swipe with a conservative 400ms duration.
 * It's designed to be extremely reliable but may not be as effective as the optimized
 * gestures for specific device types.
 *
 * Used as the final fallback when:
 * - Both Samsung-optimized and Pixel-optimized gestures fail
 * - Exceptions occur during gesture execution
 * - Other strategies throw unexpected errors
 *
 * @param screenWidth Width of the device screen in pixels
 * @param screenHeight Height of the device screen in pixels
 * @return true if the gesture was dispatched successfully, false otherwise
 */
private suspend fun AccessibilityService.trySimpleCenterSwipe(
    screenWidth: Int,
    screenHeight: Int,
): Boolean =
    try {
        Log.d("$TAG 🔄 Last-resort fallback: simple center swipe")

        val centerX = screenWidth / 2f
        val centerY = screenHeight / 2f
        val endY = screenHeight * 0.1f

        // Conservative 400ms duration for maximum compatibility
        executeSwipeGesture(centerX, centerY, centerX, endY, 400L)
    } catch (e: Exception) {
        Log.e("$TAG ❌ Error in last-resort fallback swipe: ${e.message}")
        false
    }
