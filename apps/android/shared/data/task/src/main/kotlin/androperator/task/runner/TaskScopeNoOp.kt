package androperator.task.runner

import action.system.model.ApplicationId
import kotlin.time.Duration

class TaskScopeNoOp : TaskScope {
    override suspend fun openApp(
        applicationId: ApplicationId,
        retry: TaskRetry,
    ) {
        // No-op implementation
    }

    override suspend fun openUri(
        uri: String,
        retry: TaskRetry,
    ) {
        // No-op implementation
    }

    override suspend fun pause(
        duration: Duration,
        retry: TaskRetry,
    ) {
        // No-op implementation
    }

    override suspend fun logUiTree(
        retry: TaskRetry,
    ): UiSnapshotResult {
        // No-op implementation
        return UiSnapshotResult(actualFormat = UiSnapshotActualFormat.HierarchyXml)
    }

    override suspend fun <T> ui(block: suspend TaskUiScope.() -> T): T {
        // No-op implementation for testing - UI operations are not supported
        throw UnsupportedOperationException("TaskScopeNoOp does not support UI operations")
    }

    override suspend fun closeApp(
        applicationId: ApplicationId,
        retry: TaskRetry,
    ) {
        // No-op implementation
    }

    override suspend fun waitForNavigation(
        expectedPackage: String?,
        expectedNode: NodeMatcher?,
        timeoutMs: Long,
        allowAlreadyForeground: Boolean,
    ): WaitForNavigationResult {
        throw UnsupportedOperationException("TaskScopeNoOp does not support waitForNavigation")
    }
}
