package androperator.operator.task

import action.log.Log
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** Local reporting retains the task lifecycle without a network backend. */
class TaskStatusReporterDefault(
    private val report: (TaskStatusRequest) -> Unit = { event ->
        Log.i("[Androperator-TaskStatus] %s", Json.encodeToString(event))
    },
) : TaskStatusReporter {
    override suspend fun reportStatus(
        taskId: String,
        deviceId: String,
        status: String,
        message: String,
        progressPct: Int?,
        result: String?,
        errorCode: String?,
    ): Result<Unit> = try {
        report(
            TaskStatusRequest(
                taskId = taskId,
                deviceId = deviceId,
                status = status,
                message = message,
                progressPct = progressPct,
                result = result,
                errorCode = errorCode,
            ),
        )
        Result.success(Unit)
    } catch (exception: Exception) {
        Result.failure(exception)
    }
}
