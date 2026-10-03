package androperator.uitree

import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext
import kotlin.coroutines.coroutineContext

/** Records the actual platform attempt without performing another action. */
class UiDispatchObservation(
    private val onRecord: (Any?, String, Boolean) -> Unit,
) : AbstractCoroutineContextElement(Key) {
    companion object Key : CoroutineContext.Key<UiDispatchObservation>
    private var target: Any? = null
    private var method = "none"
    // Later readiness or rejection evidence cannot make an earlier mutation safe to replay.
    var retryBlocked: Boolean = false
        private set

    fun record(target: Any?, method: String, accepted: Boolean, blocksRetry: Boolean = true) {
        retryBlocked = retryBlocked || blocksRetry
        this.target = target
        this.method = method
        onRecord(target, method, accepted)
    }
    fun accepted(accepted: Boolean) = onRecord(target, method, accepted)
}

internal suspend fun observeDispatch(target: Any?, method: String, accepted: Boolean, blocksRetry: Boolean = true) {
    coroutineContext[UiDispatchObservation]?.record(target, method, accepted, blocksRetry)
}
