package androperator.routine

interface Routine {
    /**
     * Runs until cancelled by the caller's coroutine scope.
     */
    suspend fun run(
        routineSpec: RoutineSpec,
        routineStatusSink: RoutineStatusSink,
    )
}
