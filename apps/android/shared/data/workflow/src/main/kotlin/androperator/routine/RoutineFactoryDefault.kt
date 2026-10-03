package androperator.routine

import action.time.TimeRepository
import androperator.routine.airconditioner.AirConditionerRunForDurationRoutine
import androperator.routine.temperature.TemperatureRegulatorCoolRoutine
import androperator.workflow.WorkflowManager

class RoutineFactoryDefault(
    private val workflowManager: WorkflowManager,
    private val timeRepository: TimeRepository,
) : RoutineFactory {

    override fun createAirConditionerRunForDurationRoutine(): AirConditionerRunForDurationRoutine {
        return AirConditionerRunForDurationRoutine(
            workflowManager = workflowManager,
            timeRepository = timeRepository,
        )
    }

    override fun createTemperatureRegulatorCoolRoutine(): TemperatureRegulatorCoolRoutine {
        return TemperatureRegulatorCoolRoutine(
            workflowManager = workflowManager,
            timeRepository = timeRepository,
        )
    }
}
