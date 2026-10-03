package androperator.operator.foreground

import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import android.view.accessibility.AccessibilityWindowInfo
import androperator.uitree.OperatorOverlayIdentity
import androperator.uitree.OperatorOverlayWindowIdentity

internal data class ForegroundWindow(
    val id: Int,
    val type: Int,
    val displayId: Int,
    val active: Boolean,
    val focused: Boolean,
    val packageName: String?,
    val ownedOverlay: Boolean = false,
)

/** Does not use event packages, accessibility focus, or a background-root fallback. */
internal fun selectForegroundApplication(
    windows: List<ForegroundWindow>,
    displayId: Int,
    locked: Boolean = false,
): ForegroundApplicationState {
    if (locked) return ForegroundApplicationState.Locked
    val eligible = windows.filter {
        it.displayId == displayId && !it.ownedOverlay && it.type != AccessibilityWindowInfo.TYPE_INPUT_METHOD
    }
    val blockers = eligible.filter { (it.active || it.focused) && it.type != AccessibilityWindowInfo.TYPE_APPLICATION }
    if (blockers.isNotEmpty()) {
        // Only a verified system window permits retaining the last app. Unknown overlays do not.
        return if (blockers.all { it.type == AccessibilityWindowInfo.TYPE_SYSTEM }) {
            ForegroundApplicationState.SystemPanel(displayId)
        } else ForegroundApplicationState.Unavailable
    }
    val focused = eligible.filter { it.focused }
    val candidates = if (focused.isNotEmpty()) focused else eligible.filter { it.active }
    val current = candidates.singleOrNull() ?: return ForegroundApplicationState.Unavailable
    val packageName = current.packageName?.takeIf { it.isNotBlank() }
        ?: return ForegroundApplicationState.Unavailable
    return ForegroundApplicationState.Available(packageName, displayId)
}

/** Reads only window metadata and each window root's package; never traverses a hierarchy. */
class ForegroundApplicationReader(private val overlayIdentity: OperatorOverlayIdentity) {
    fun read(service: AccessibilityService, displayId: Int): ForegroundApplicationState {
        val keyguard = service.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        if (keyguard?.isKeyguardLocked == true) return ForegroundApplicationState.Locked
        val allWindows = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val byDisplay = service.windowsOnAllDisplays
            (0 until byDisplay.size()).flatMap { byDisplay.valueAt(it).orEmpty() }
        } else {
            if (displayId != 0) return ForegroundApplicationState.Unavailable
            service.windows.orEmpty()
        }
        try {
            val windows = allWindows.filter { Build.VERSION.SDK_INT < Build.VERSION_CODES.R || it.displayId == displayId }
            val candidates = windows.map { window ->
                val owned = overlayIdentity.ownsOverlayWindow(
                    OperatorOverlayWindowIdentity(window.id, window.type, if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) window.title?.toString() else null),
                )
                val packageName = if (!owned && window.type == AccessibilityWindowInfo.TYPE_APPLICATION &&
                    (window.isActive || window.isFocused)
                ) {
                    val root = window.root
                    try {
                        root?.packageName?.toString()
                    } finally {
                        @Suppress("DEPRECATION")
                        root?.recycle()
                    }
                } else null
                ForegroundWindow(window.id, window.type, displayId, window.isActive, window.isFocused, packageName, owned)
            }
            return selectForegroundApplication(candidates, displayId)
        } finally {
            @Suppress("DEPRECATION")
            allWindows.forEach { it.recycle() }
        }
    }
}
