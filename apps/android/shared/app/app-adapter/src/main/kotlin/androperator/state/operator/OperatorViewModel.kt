package androperator.state.operator

import action.coroutine.flow.combineDistinct
import action.resources.string.StringRepository
import androidx.lifecycle.ViewModel
import androperator.accessibilityservice.AccessibilityServiceManager
import action.developeroptions.DeveloperOptionsManager
import androperator.state.operator.AppDoctorState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn

class OperatorViewModel(
    private val operatorRepository: OperatorRepository,
    private val accessibilityServiceManager: AccessibilityServiceManager,
    private val developerOptionsManager: DeveloperOptionsManager,
    private val stringRepository: StringRepository,
    private val coroutineScope: CoroutineScope,
) : ViewModel() {
    val isReady: Flow<Boolean>
        get() = operatorRepository.isReady

    private fun mapViewState(
        developerOptionsEnabled: Boolean,
        usbDebuggingEnabled: Boolean,
        accessibilityIsRunning: Boolean,
    ): OperatorViewState.Data {
        val appDoctorState = when {
            !developerOptionsEnabled -> AppDoctorState.DeveloperOptionsDisabled
            !usbDebuggingEnabled -> AppDoctorState.UsbDebuggingDisabled
            !accessibilityIsRunning -> AppDoctorState.PermissionsNotGranted
            else -> AppDoctorState.Ready
        }
        val label =
            if (accessibilityIsRunning) {
                stringRepository.accessibilityPermissionStatusGranted
            } else {
                stringRepository.accessibilityPermissionStatusNotGranted
            }

        return OperatorViewState.Data(
            appDoctorState = appDoctorState,
            accessibilityPermissionLabel = label,
        )
    }

    val viewState: StateFlow<OperatorViewState> =
        combineDistinct(
            isReady,
            developerOptionsManager.isEnabled,
            developerOptionsManager.isUsbDebuggingEnabled,
            accessibilityServiceManager.isRunning,
        ) { isReady, developerOptionsEnabled, usbDebuggingEnabled, accessibilityIsRunning ->
            if (isReady) {
                mapViewState(
                    developerOptionsEnabled = developerOptionsEnabled,
                    usbDebuggingEnabled = usbDebuggingEnabled,
                    accessibilityIsRunning = accessibilityIsRunning,
                )
            } else {
                OperatorViewState.Loading
            }
        }.stateIn(
            scope = coroutineScope,
            started = SharingStarted.WhileSubscribed(),
            initialValue = OperatorViewState.Loading
        )

    suspend fun onBackPress() {
    }
}
