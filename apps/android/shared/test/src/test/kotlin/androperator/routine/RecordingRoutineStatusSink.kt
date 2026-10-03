package androperator.routine

class RecordingRoutineStatusSink : RoutineStatusSink {
    data class LogEvent(val message: String, val data: Map<String, String>)
    data class StageEvent(val type: String, val id: String, val title: String? = null, val reason: String? = null)

    val logs = mutableListOf<LogEvent>()
    val stages = mutableListOf<StageEvent>()

    override fun log(message: String, data: Map<String, String>) {
        logs += LogEvent(message, data)
    }

    override fun stageStart(id: String, title: String, data: Map<String, String>) {
        stages += StageEvent("start", id, title)
    }

    override fun stageSuccess(id: String, data: Map<String, String>) {
        stages += StageEvent("success", id)
    }

    override fun stageFailure(id: String, reason: String, data: Map<String, String>) {
        stages += StageEvent("failure", id, reason = reason)
    }
}
