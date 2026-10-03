package androperator.state.operator

import androperator.app.AppScreenState
import androidx.compose.runtime.Stable

@Stable
sealed interface OperatorViewState : AppScreenState {
    @Stable
    data object Loading : OperatorViewState

    @Stable
    data class Data(
        val appDoctorState: AppDoctorState,
        /** Label for the permissions-not-granted state (e.g. accessibility status text). */
        val accessibilityPermissionLabel: String,
    ) : OperatorViewState
}
