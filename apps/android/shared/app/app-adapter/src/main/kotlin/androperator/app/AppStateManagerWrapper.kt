package androperator.app

import action.system.window.WindowFrameManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.StateFlow

/**
 * Wrapper class to allow AppStateManager to be injected across the app. Requires that
 * [setAppViewModel] be manually called with the actual [AppStateManager].
 */
class AppStateManagerWrapper(
    windowFrameManager: WindowFrameManager,
) : AppStateManager {
    override val isUiReady: StateFlow<Boolean> = windowFrameManager.isReady

    /**
     * Hack to work around DI creation order
     */
    private lateinit var appViewModel: AppViewModel

    fun setAppViewModel(appViewModel: AppViewModel) {
        this.appViewModel = appViewModel
    }

    override val appViewState: Flow<AppViewState>
        get() = appViewModel.appViewState
}
