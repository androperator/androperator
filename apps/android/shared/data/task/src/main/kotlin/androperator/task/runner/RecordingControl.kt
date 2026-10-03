package androperator.task.runner

interface RecordingManager {
    suspend fun startRecording(sessionId: String?): RecordingCommandOutcome

    suspend fun stopRecording(sessionId: String?): RecordingCommandOutcome

    fun isRecordingActive(): Boolean
}

object RecordingManagerNoOp : RecordingManager {
    override suspend fun startRecording(sessionId: String?): RecordingCommandOutcome =
        RecordingCommandOutcome.Error(
            code = "RECORDING_UNAVAILABLE",
            message = "RecordingManager is not configured",
        )

    override suspend fun stopRecording(sessionId: String?): RecordingCommandOutcome =
        RecordingCommandOutcome.Error(
            code = "RECORDING_UNAVAILABLE",
            message = "RecordingManager is not configured",
        )

    override fun isRecordingActive(): Boolean = false
}

sealed interface RecordingCommandOutcome {
    data class Started(
        val sessionId: String,
        val filePath: String,
    ) : RecordingCommandOutcome

    data class Stopped(
        val sessionId: String,
        val filePath: String,
        val eventCount: Int,
    ) : RecordingCommandOutcome

    data class Error(
        val code: String,
        val message: String,
        val sessionId: String? = null,
        val filePath: String? = null,
        val eventCount: Int? = null,
    ) : RecordingCommandOutcome
}

const val ERROR_RECORDING_ALREADY_IN_PROGRESS = "RECORDING_ALREADY_IN_PROGRESS"
const val ERROR_RECORDING_NOT_IN_PROGRESS = "RECORDING_NOT_IN_PROGRESS"
