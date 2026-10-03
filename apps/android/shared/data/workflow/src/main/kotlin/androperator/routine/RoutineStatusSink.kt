package androperator.routine

interface RoutineStatusSink {
    fun log(message: String, data: Map<String, String> = emptyMap())
    fun stageStart(id: String, title: String, data: Map<String, String> = emptyMap())
    fun stageSuccess(id: String, data: Map<String, String> = emptyMap())
    fun stageFailure(id: String, reason: String, data: Map<String, String> = emptyMap())

    object NoOp : RoutineStatusSink {
        override fun log(message: String, data: Map<String, String>) = Unit
        override fun stageStart(id: String, title: String, data: Map<String, String>) = Unit
        override fun stageSuccess(id: String, data: Map<String, String>) = Unit
        override fun stageFailure(id: String, reason: String, data: Map<String, String>) = Unit
    }
}
