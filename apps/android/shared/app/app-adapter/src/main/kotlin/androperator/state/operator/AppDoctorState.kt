package androperator.state.operator

import androidx.compose.runtime.Stable

/**
 * Current state of the operator app "doctor" check. All three requirements must be
 * satisfied before the operator is considered ready (green background).
 */
@Stable
enum class AppDoctorState {
    /** 1. Developer settings are not enabled (Build number not tapped 7 times). */
    DeveloperOptionsDisabled,

    /** 2. USB debugging is not enabled in Developer options. */
    UsbDebuggingDisabled,

    /** 3. Accessibility (operator) permissions are not granted / service not running. */
    PermissionsNotGranted,

    /** All three requirements are met. */
    Ready,
}
