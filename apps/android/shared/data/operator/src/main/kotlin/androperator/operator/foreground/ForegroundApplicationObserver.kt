package androperator.operator.foreground

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import androidx.annotation.MainThread
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.buffer
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.launch

data class ForegroundApplicationIdentity(val packageName: String, val displayId: Int)

sealed interface ForegroundApplicationState {
    val foregroundState: String
    val foregroundApp: ForegroundApplicationIdentity?

    data class Available(val packageName: String, val displayId: Int) : ForegroundApplicationState {
        override val foregroundState = "app_focused"
        override val foregroundApp get() = ForegroundApplicationIdentity(packageName, displayId)
    }

    data class SystemPanel(
        val displayId: Int,
        override val foregroundApp: ForegroundApplicationIdentity? = null,
    ) : ForegroundApplicationState {
        override val foregroundState = "system_panel"
    }

    data object Locked : ForegroundApplicationState {
        override val foregroundState = "locked"
        override val foregroundApp = null
    }

    data object Unavailable : ForegroundApplicationState {
        override val foregroundState = "unavailable"
        override val foregroundApp = null
    }
}

/** Main-thread lifecycle owner. Collectors may subscribe from any coroutine dispatcher. */
class ForegroundApplicationObserver internal constructor(
    private val scope: CoroutineScope,
    private val read: suspend (AccessibilityService, Int) -> ForegroundApplicationState,
) {
    constructor(reader: ForegroundApplicationReader) : this(
        CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate),
        { service, displayId -> reader.read(service, displayId) },
    )

    private class Subscriber(val displayId: Int, val scope: CoroutineScope, val emit: (ForegroundApplicationState) -> Unit) {
        private var lastVerifiedApp: ForegroundApplicationIdentity? = null
        private var pendingUnavailable: Job? = null

        fun cancelPending() {
            pendingUnavailable?.cancel()
            pendingUnavailable = null
        }

        fun acceptRead(state: ForegroundApplicationState) {
            if (state != ForegroundApplicationState.Unavailable) {
                publish(state)
            } else if (pendingUnavailable == null) {
                // New events must not extend the bounded missing-window grace period.
                pendingUnavailable = scope.launch {
                    delay(350)
                    publish(ForegroundApplicationState.Unavailable)
                }
            }
        }

        fun publish(state: ForegroundApplicationState) {
            cancelPending()
            val observation = when (state) {
                is ForegroundApplicationState.SystemPanel -> state.copy(foregroundApp = lastVerifiedApp)
                else -> state.also { lastVerifiedApp = it.foregroundApp }
            }
            emit(observation)
        }
    }

    private val subscribers = mutableSetOf<Subscriber>()
    private var service: AccessibilityService? = null
    private var generation = 0L
    private var reconciliation: Job? = null

    internal val isObserving: Boolean
        @MainThread get() = subscribers.isNotEmpty()

    /** Emits current identity or unavailable. No cached identity or pending history is replayed. */
    fun observe(displayId: Int = 0): Flow<ForegroundApplicationState> = callbackFlow {
        require(displayId >= 0)
        val subscriber = Subscriber(displayId, scope) { trySend(it) }
        subscribers.add(subscriber)
        trySend(ForegroundApplicationState.Unavailable)
        reconcile()
        awaitClose {
            scope.launch {
                subscribers.remove(subscriber)
                subscriber.cancelPending()
                if (subscribers.isEmpty()) invalidate()
            }
        }
    }.buffer(Channel.CONFLATED).flowOn(scope.coroutineContext.minusKey(Job)).distinctUntilChanged()

    @MainThread
    fun attach(service: AccessibilityService) {
        invalidate()
        this.service = service
        subscribers.forEach { it.publish(ForegroundApplicationState.Unavailable) }
        reconcile()
    }

    @MainThread
    fun detach(service: AccessibilityService) {
        // A late destruction callback from an old service must not detach its replacement.
        if (this.service !== service) return
        invalidate()
        this.service = null
        subscribers.forEach { it.publish(ForegroundApplicationState.Unavailable) }
    }

    @MainThread
    fun onAccessibilityEvent(service: AccessibilityService, event: AccessibilityEvent?) {
        if (this.service !== service || event == null || subscribers.isEmpty()) return
        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOWS_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_VIEW_FOCUSED,
            AccessibilityEvent.TYPE_VIEW_CLICKED,
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> reconcile()
        }
    }

    private fun invalidate() {
        generation += 1
        reconciliation?.cancel()
        reconciliation = null
    }

    private fun reconcile() {
        invalidate()
        val attached = service ?: return
        if (subscribers.isEmpty()) return
        val requestedGeneration = generation
        reconciliation = scope.launch {
            // Retry transient missing roots within a bounded window, never continuously poll.
            for (retryDelay in listOf(0L, 100L, 200L)) {
                if (retryDelay > 0) delay(retryDelay)
                var unavailable = false
                for (displayId in subscribers.map { it.displayId }.distinct()) {
                    val state = try {
                        read(attached, displayId)
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (_: Exception) {
                        ForegroundApplicationState.Unavailable
                    }
                    if (generation != requestedGeneration || service !== attached) return@launch
                    subscribers.filter { it.displayId == displayId }.forEach { it.acceptRead(state) }
                    unavailable = unavailable || state == ForegroundApplicationState.Unavailable
                }
                if (!unavailable) break
            }
        }
    }
}
