package androperator.app

import kotlinx.coroutines.flow.Flow

interface AppStateManager {
    val isUiReady: Flow<Boolean>

    val appViewState: Flow<AppViewState>
}
