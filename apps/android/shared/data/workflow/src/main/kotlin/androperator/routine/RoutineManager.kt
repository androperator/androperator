package androperator.routine

interface RoutineManager {
    /** Returns true if a routine is currently running. */
    val isRunning: Boolean

    /**
     * Runs the internal event loop.
     * Should be launched once from a long-lived scope.
     */
    suspend fun runLoop()

    /**
     * Starts a new routine.
     * Cancels any existing one before starting.
     * Returns a unique id for the launched routine.
     */
    fun start(build: () -> RoutineRun): RoutineId

    /** Cancels the currently running routine, if any. */
    fun cancelCurrent(): Boolean
}

