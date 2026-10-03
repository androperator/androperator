package androperator.operator.debug

import android.app.Activity
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import androperator.operator.foreground.ForegroundApplicationObserver
import androperator.accessibilityservice.AccessibilityServiceManagerAndroid
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject

/** Privileged, debug-only, bounded Android consumer. It never records or drives navigation. */
class ForegroundObservationProofActivity : Activity(), KoinComponent {
    private val observer: ForegroundApplicationObserver by inject()

    private val services: AccessibilityServiceManagerAndroid by inject()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        observation?.cancel()
        val durationMs = intent.getLongExtra("duration_ms", 60_000L).coerceIn(1L, 600_000L)
        observation = scope.launch {
            Log.i(TAG, "START uptimeMs=${SystemClock.uptimeMillis()} durationMs=$durationMs")
            try {
                withTimeoutOrNull(durationMs) {
                    observer.observe().collect { state ->
                        Log.i(TAG, "STATE uptimeMs=${SystemClock.uptimeMillis()} state=$state")
                        Log.i("AndroperatorForegroundApp", "foreground_state=${state.foregroundState} foreground_app=${state.foregroundApp?.packageName ?: "unknown"} displayId=${state.foregroundApp?.displayId ?: 0}")
                        val windows = services.currentAccessibilityServiceFlow.value?.windows.orEmpty()
                        try {
                            windows.forEach { window ->
                                val root = window.root
                                try {
                                    Log.i(TAG, "WINDOW id=${window.id} type=${window.type} active=${window.isActive} focused=${window.isFocused} package=${root?.packageName}")
                                } finally {
                                    @Suppress("DEPRECATION")
                                    root?.recycle()
                                }
                            }
                        } finally {
                            @Suppress("DEPRECATION")
                            windows.forEach { it.recycle() }
                        }
                    }
                }
            } finally {
                Log.i(TAG, "STOP uptimeMs=${SystemClock.uptimeMillis()}")
            }
        }
        finish()
    }

    private companion object {
        const val TAG = "ForegroundObservationProof"
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        var observation: Job? = null
    }
}
