package androperator.task.runner

import kotlin.time.Duration

data class TaskRetry(
    /** Total attempts (including initial). 1 = no retry, 2 = retry once, etc. **/
    val maxAttempts: Int = 1,
    /** Delay before first retry attempt **/
    val initialDelay: Duration = Duration.ZERO,
    /** Maximum delay between attempts (clamps exponential growth) **/
    val maxDelay: Duration = initialDelay,
    /** Multiplier for exponential backoff (2.0 = delay doubles each retry) **/
    val backoffMultiplier: Double = 1.0,
    /** Randomization factor 0.0-1.0. Adds ±(delay×ratio) randomness to prevent thundering herd **/
    val jitterRatio: Double = 0.0,
) {
    init {
        require(maxAttempts >= 1) { "maxAttempts must be >= 1" }
        require(initialDelay >= Duration.ZERO) { "initialDelay must be >= 0" }
        require(maxDelay >= Duration.ZERO) { "maxDelay must be >= 0" }
        require(backoffMultiplier >= 1.0) { "backoffMultiplier must be >= 1.0" }
        require(jitterRatio in 0.0..1.0) { "jitterRatio must be in [0.0, 1.0]" }
    }

    companion object {
        val None = TaskRetry(maxAttempts = 1)

        fun exponential(
            maxAttempts: Int,
            initialDelay: Duration,
            maxDelay: Duration,
            /** 2.0 = delay doubles each retry **/
            backoffMultiplier: Double = 2.0,
            /** 0.15 = ±15% randomization (prevents thundering herd) **/
            jitterRatio: Double = 0.15,
        ) = TaskRetry(
            maxAttempts = maxAttempts,
            initialDelay = initialDelay,
            maxDelay = maxDelay,
            backoffMultiplier = backoffMultiplier,
            jitterRatio = jitterRatio,
        )
    }
}
