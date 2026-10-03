package androperator.app

import action.coroutine.flow.combineDistinct
import androperator.app.AppScreenState
import androperator.state.operator.OperatorViewModel
import androperator.state.operator.OperatorViewState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class AppViewModel(
    appStateManager: AppStateManager,
    private val operatorViewModel: OperatorViewModel,
    private val coroutineScope: CoroutineScope,
) : AppStateManager {
    override val isUiReady: Flow<Boolean>
        get() = operatorViewModel.isReady

    private val currentScreenViewState: StateFlow<AppScreenState> by lazy {
        operatorViewModel.viewState
    }

    private val backHandlerEnabled: MutableStateFlow<Boolean> = MutableStateFlow(true)
    private val onBackAction: () -> Unit = {
        coroutineScope.launch {
            operatorViewModel.onBackPress()
        }
        Unit
    }

    override val appViewState: StateFlow<AppViewState> by lazy {
        combineDistinct(currentScreenViewState, backHandlerEnabled) { screenViewState, backHandlerEnabled ->
            when (screenViewState) {
                is OperatorViewState.Loading -> AppViewState.Loading()
                is OperatorViewState.Data -> AppViewState.Data(
                    screenViewState = screenViewState,
                    backHandlerEnabled = backHandlerEnabled,
                    onBack = onBackAction,
                )
                else -> AppViewState.Loading()
            }
        }.stateIn(
            scope = coroutineScope,
            started = SharingStarted.WhileSubscribed(),
            initialValue = AppViewState.Loading()
        )
    }

    init {
        if (appStateManager is AppStateManagerWrapper) {
            appStateManager.setAppViewModel(this)
        }
    }
}
