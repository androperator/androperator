package androperator.application

import action.appvisibility.AppVisibility
import action.appvisibility.AppVisibilityDefaultProcess
import action.di.Lazy
import action.log.Log
import action.time.TimeRepository
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleObserver
import androidx.lifecycle.OnLifecycleEvent

class ApplicationLifecycleObserver(
    appVisibility: AppVisibility,
//    private val appStateLazy: Lazy<AppState>,
    private val timeRepository: Lazy<TimeRepository>,
) : LifecycleObserver {
    //    private val appState: AppState by lazy { appStateLazy.get() }

    private val currentTime: Long
        get() = timeRepository.get().let { it.currentTimeVerified ?: it.currentTime }

    private val appVisibilityDefaultProcess: AppVisibilityDefaultProcess? by lazy {
        if (appVisibility is AppVisibilityDefaultProcess) {
            appVisibility
        } else {
            null
        }
    }

    @OnLifecycleEvent(Lifecycle.Event.ON_START)
    fun onStart() {
        Log.d("[default] ApplicationObserver.onStart()")

        appVisibilityDefaultProcess?.updateVisibility(true)
    }

    @OnLifecycleEvent(Lifecycle.Event.ON_STOP)
    fun onStop() {
        Log.d("[default] ApplicationObserver.onStop()")

//        appState.lastAppCloseTime.update(currentTime)
        appVisibilityDefaultProcess?.updateVisibility(false)
    }
}
