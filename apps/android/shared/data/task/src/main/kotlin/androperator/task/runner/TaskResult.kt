package androperator.task.runner

sealed interface TaskResult<out T> {
    data class Success<T>(
        val value: T,
    ) : TaskResult<T>

    data class Failed(
        val reason: String,
        val cause: Throwable? = null,
    ) : TaskResult<Nothing>
}

/**
 * Convenience helpers for working with TaskResult.
 */

inline fun <T> TaskResult<T>.getOrThrow(): T =
    when (this) {
        is TaskResult.Success -> value
        is TaskResult.Failed -> throw IllegalStateException(reason, cause)
    }

inline fun <T> TaskResult<T>.getOrNull(): T? = (this as? TaskResult.Success)?.value

val <T> TaskResult<T>.valueOrNull: T?
    get() = when (this) {
        is TaskResult.Success -> this.value
        else -> null
    }

val TaskResult<*>.isSuccess: Boolean
    get() = this is TaskResult.Success

/**
 * Type aliases for common cases.
 */

typealias TaskUnitResult = TaskResult<Unit>
