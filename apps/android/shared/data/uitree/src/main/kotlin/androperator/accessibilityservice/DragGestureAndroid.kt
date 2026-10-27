package androperator.accessibilityservice

import action.coroutine.ensureExecutionActive
import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Handler
import android.os.Looper
import androidx.annotation.RequiresApi
import androperator.uitree.DragWaypoint
import androperator.uitree.UiDispatchObservation
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.coroutineContext
import kotlin.coroutines.resume

/** Each segment continues the original pointer, including hover pauses. */
@RequiresApi(26)
suspend fun AccessibilityService.dispatchDrag(
    startX: Float, startY: Float, endX: Float, endY: Float,
    holdDurationMs: Long, moveDurationMs: Long, waypoints: List<DragWaypoint> = emptyList(),
): Boolean {
    val observation = coroutineContext[UiDispatchObservation]
    val handler = Handler(Looper.getMainLooper())
    val points = waypoints + DragWaypoint(endX.toInt(), endY.toInt(), moveDurationMs)
    return suspendCancellableCoroutine { continuation ->
        var x = startX
        var y = startY
        var stroke: GestureDescription.StrokeDescription? = null
        var inFlight = false
        var releasing = false
        var pending: Runnable? = null
        fun finish(success: Boolean) { if (continuation.isActive) continuation.resume(success) }
        fun release(success: Boolean) {
            if (inFlight || releasing) return
            val previous = stroke ?: return
            // Final movement may complete before queued cancellation cleanup runs.
            // Its non-continuing stroke already released the pointer.
            if (!previous.willContinue()) return
            releasing = true
            val path = Path().apply { moveTo(x, y) }
            val up = previous.continueStroke(path, 0, 1, false)
            try {
                if (!dispatchGesture(GestureDescription.Builder().addStroke(up).build(), object : AccessibilityService.GestureResultCallback() {
                    override fun onCompleted(gestureDescription: GestureDescription?) = finish(success)
                    override fun onCancelled(gestureDescription: GestureDescription?) = finish(false)
                }, handler)) finish(false)
            } catch (_: Exception) { finish(false) }
        }
        fun segment(index: Int) {
            if (!continuation.isActive) { release(false); return }
            if (index == points.size) { release(true); return }
            try { continuation.context.ensureExecutionActive() } catch (_: Exception) { release(false); return }
            val point = points[index]
            val stationary = x == point.x.toFloat() && y == point.y.toFloat()
            val path = Path().apply { moveTo(x, y); if (!stationary) lineTo(point.x.toFloat(), point.y.toFloat()) }
            val finalMovement = index == points.lastIndex && !stationary
            val next = stroke!!.continueStroke(path, 0, if (stationary) 1 else point.durationMs, !finalMovement)
            inFlight = true
            try {
                val accepted = dispatchGesture(GestureDescription.Builder().addStroke(next).build(), object : AccessibilityService.GestureResultCallback() {
                    override fun onCompleted(gestureDescription: GestureDescription?) {
                        inFlight = false
                        stroke = next
                        x = point.x.toFloat()
                        y = point.y.toFloat()
                        if (finalMovement) { finish(true); return }
                        if (!continuation.isActive) { release(false); return }
                        pending = Runnable { segment(index + 1) }.also { handler.postDelayed(it, point.holdDurationMs + if (stationary) point.durationMs else 0) }
                    }
                    override fun onCancelled(gestureDescription: GestureDescription?) { inFlight = false; finish(false) }
                }, handler)
                if (!accepted) { inFlight = false; release(false) }
            } catch (_: Exception) { inFlight = false; release(false) }
        }
        continuation.invokeOnCancellation { handler.post { pending?.let { handler.removeCallbacks(it) }; release(false) } }
        handler.post {
            if (!continuation.isActive) return@post
            val first = GestureDescription.StrokeDescription(Path().apply { moveTo(x, y) }, 0, 1, true)
            inFlight = true
            try {
                continuation.context.ensureExecutionActive()
                val accepted = dispatchGesture(GestureDescription.Builder().addStroke(first).build(), object : AccessibilityService.GestureResultCallback() {
                    override fun onCompleted(gestureDescription: GestureDescription?) {
                        inFlight = false
                        stroke = first
                        if (!continuation.isActive) { release(false); return }
                        pending = Runnable { segment(0) }.also { handler.postDelayed(it, holdDurationMs) }
                    }
                    override fun onCancelled(gestureDescription: GestureDescription?) { inFlight = false; finish(false) }
                }, handler)
                observation?.accepted(accepted)
                if (!accepted) { inFlight = false; finish(false) }
            } catch (_: Exception) { inFlight = false; finish(false) }
        }
    }
}
