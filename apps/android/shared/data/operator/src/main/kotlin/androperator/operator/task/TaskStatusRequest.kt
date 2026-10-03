package androperator.operator.task

import kotlinx.serialization.Serializable

@Serializable
data class TaskStatusRequest(
    val taskId: String,
    val deviceId: String,
    val status: String,
    val message: String,
    val progressPct: Int? = null,
    val result: String? = null,
    val errorCode: String? = null,
)
