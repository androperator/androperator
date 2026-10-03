package androperator.resources.string

/**
 * Minimal string interface for Androperator operator.
 * Stripped down to only essential strings needed for the operator UI.
 */
interface Strings {
    val accessibilityPermissionStatusGranted: String get() = "Accessibility permission status: Granted"
    val accessibilityPermissionStatusNotGranted: String get() = "Accessibility permission status: Not Granted"
}
