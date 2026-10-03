package androperator.routine

data class RoutineRun(
    val routine: Routine,
    val routineSpec: RoutineSpec,
    val routineStatusSink: RoutineStatusSink,
)
