package androperator.app

import androidx.compose.runtime.Stable

/** Marker for the current screen state shown by the app. Implemented by app-adapter screen states. */
@Stable
interface AppScreenState

@Stable
sealed interface AppViewState {
    val onBack: () -> Unit
    val backHandlerEnabled: Boolean

    @Stable
    data class Loading(
        override val backHandlerEnabled: Boolean = false,
        override val onBack: () -> Unit = { },
    ) : AppViewState

    @Stable
    data class Data(
        val screenViewState: AppScreenState,
        override val backHandlerEnabled: Boolean,
        override val onBack: () -> Unit,
    ) : AppViewState
}
