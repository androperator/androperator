package action.coroutine

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ensureActive
import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext
import kotlin.time.TimeSource
import kotlin.time.Duration.Companion.milliseconds

/** Monotonic guard for blocking work that can delay cooperative timeout delivery. */
class ExecutionDeadline(val timeoutMs: Long, timeSource: TimeSource = TimeSource.Monotonic) : AbstractCoroutineContextElement(Key) {
    companion object Key : CoroutineContext.Key<ExecutionDeadline>
    private val started = timeSource.markNow()

    fun throwIfExpired() {
        if (started.elapsedNow() >= timeoutMs.milliseconds) throw ExecutionDeadlineExceeded(timeoutMs)
    }
}

class ExecutionDeadlineExceeded(timeoutMs: Long) : CancellationException("Command deadline expired after ${timeoutMs}ms")

fun CoroutineContext.ensureExecutionActive() {
    this[ExecutionDeadline]?.throwIfExpired()
    ensureActive()
}
