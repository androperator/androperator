package androperator.routine.airconditioner

import androperator.routine.RoutineSpec
import androperator.uitree.ToggleState
import kotlin.time.Duration

data class AirConditionerRunForDurationRoutineSpec(
    /** How long to keep the AC On, starting now. */
    val runDuration: Duration,
    /** State to set at start of run. Default On. */
    val startState: ToggleState = ToggleState.On,
    /** State to set at end of run. Default Off. */
    val endState: ToggleState = ToggleState.Off,
    /** Optional: if true, skip sending state change when already in desired start state. Default true. */
    val skipRedundantStart: Boolean = true,
) : RoutineSpec {
    init { require(runDuration >= Duration.ZERO) { "runDuration must be >= 0" } }
    init { require(startState != endState) { "startState and endState must differ" } }
}
