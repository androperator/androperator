package androperator.apps.uninstall

import action.system.model.ApplicationId
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

class UninstallAppManagerNoOp : UninstallAppManager {
    override fun canUninstallApp(applicationId: ApplicationId): Flow<Boolean> = flowOf(false)

    override fun uninstallApp(applicationId: ApplicationId): Flow<UninstallAppState> = flowOf(UninstallAppState.NotUninstalled)
}
