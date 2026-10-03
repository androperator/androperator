package androperator.trigger

import androperator.data.trigger.TriggerEvent

interface TriggerManager {
    fun trigger(event: TriggerEvent)
}
