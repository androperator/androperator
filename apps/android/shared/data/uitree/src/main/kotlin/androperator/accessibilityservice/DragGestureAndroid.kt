package androperator.accessibilityservice

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Handler
import android.os.Looper
import androidx.annotation.RequiresApi
import androperator.uitree.UiDispatchObservation
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.coroutineContext
import kotlin.coroutines.resume

/** Holds and moves one pointer. Cancellation never starts a new movement segment. */
@RequiresApi(26)
suspend fun AccessibilityService.dispatchDrag(
    startX: Float,
    startY: Float,
    endX: Float,
    endY: Float,
    holdDurationMs: Long,
    moveDurationMs: Long,
): Boolean {
    val observation = coroutineContext[UiDispatchObservation]
    val handler = Handler(Looper.getMainLooper())
    val holdPath = Path().apply { moveTo(startX, startY) }
    val hold = GestureDescription.StrokeDescription(holdPath, 0, 1, true)
    val movePath = Path().apply { moveTo(startX, startY); lineTo(endX, endY) }
    val move = hold.continueStroke(movePath, 0, moveDurationMs, false)
    // The execution deadline owns timeout; service callback latency is not gesture duration.
    return suspendCancellableCoroutine { continuation ->
        // All state changes and platform calls run on the main handler.
        var holdCompleted = false
        var movementStarted = false
        var releaseStarted = false
        fun finish(success: Boolean) {
            if (continuation.isActive) continuation.resume(success)
        }
        fun release() {
            if (releaseStarted || movementStarted) return
            releaseStarted = true
            // Continue the held pointer, rather than injecting a fresh tap.
            val gesture = GestureDescription.Builder()
                .addStroke(hold.continueStroke(holdPath, 0, 1, false)).build()
            val callback = object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) = finish(false)
                override fun onCancelled(gestureDescription: GestureDescription?) = finish(false)
            }
            try {
                if (!dispatchGesture(gesture, callback, handler)) finish(false)
            } catch (_: Exception) {
                finish(false)
            }
        }
        val moveCallback = object : AccessibilityService.GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) = finish(true)
            override fun onCancelled(gestureDescription: GestureDescription?) = finish(false)
        }
        val startMovement = Runnable {
            if (!continuation.isActive) {
                release()
            } else {
                try {
                    val accepted = dispatchGesture(GestureDescription.Builder().addStroke(move).build(), moveCallback, handler)
                    movementStarted = accepted
                    // Keep the earlier accepted hold in the action receipt even if movement fails.
                    if (!accepted) release()
                } catch (_: Exception) {
                    release()
                }
            }
        }
        val holdCallback = object : AccessibilityService.GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                holdCompleted = true
                if (!continuation.isActive) {
                    release()
                } else {
                    // A stationary continuing stroke can complete as soon as DOWN is delivered:
                    // there are no later motion events to delay its completion callback.
                    // Wait after that acknowledgement so the app observes a real long press.
                    handler.postDelayed(startMovement, holdDurationMs)
                }
            }
            override fun onCancelled(gestureDescription: GestureDescription?) = finish(false)
        }
        continuation.invokeOnCancellation {
            handler.post {
                handler.removeCallbacks(startMovement)
                if (holdCompleted) release()
                // If holding, its callback will release. If moving, the bounded,
                // non-continuing stroke already owns pointer-up at its endpoint.
            }
        }
        handler.post {
            if (!continuation.isActive) return@post
            try {
                val accepted = dispatchGesture(GestureDescription.Builder().addStroke(hold).build(), holdCallback, handler)
                observation?.accepted(accepted)
                if (!accepted) finish(false)
            } catch (_: Exception) {
                finish(false)
            }
        }
    }
}
