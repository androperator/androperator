package androperator.routine

import androperator.routine.airconditioner.AirConditionerRunForDurationRoutine
import androperator.routine.temperature.TemperatureRegulatorCoolRoutine

interface RoutineFactory {

    fun createAirConditionerRunForDurationRoutine(): AirConditionerRunForDurationRoutine

    fun createTemperatureRegulatorCoolRoutine(): TemperatureRegulatorCoolRoutine
}
