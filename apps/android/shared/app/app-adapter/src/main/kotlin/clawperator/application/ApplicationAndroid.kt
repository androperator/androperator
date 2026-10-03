package clawperator.application

import action.buildconfig.BuildConfig
import action.coroutine.CoroutineContextProvider
import action.crashtracking.CrashTrackingHolder
import action.crashtracking.CrashTrackingLocal
import action.devicestate.DeviceState
import action.devicestate.DeviceStateSystem
import action.log.Log
import action.process.Process
import action.theme.SystemTheme
import action.time.TimeRepository
import action.time.TimeRepositorySystem
import android.content.Context
import androidx.lifecycle.ProcessLifecycleOwner
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject

open class ApplicationAndroid :
    Application,
    KoinComponent {
    private val context: Context by inject()

    private val deviceState: DeviceState by inject()

    private val applicationLifecycleObserver: ApplicationLifecycleObserver by inject()
    private val coroutineContextProvider: CoroutineContextProvider by inject()
    private val process: Process by inject()
    private val timeRepository: TimeRepository by inject()
    private val systemTheme: SystemTheme by inject()
    private val buildConfig: BuildConfig by inject()

    fun onCreatePre() {
    }

    fun onCreatePost() {
        if (deviceState.isUserUnlocked) {
            init()
        } else {
            deviceState.registerForUserUnlock {
                init()
            }
        }
        val deviceState = deviceState
        if (deviceState is DeviceStateSystem) {
            deviceState.register(context)
        }

        ProcessLifecycleOwner.get().lifecycle.addObserver(applicationLifecycleObserver)

        val timeRepository = timeRepository
        if (timeRepository is TimeRepositorySystem) {
            timeRepository.registerForUserTimeChange(context)
        }
    }

    open fun onTrimMemory(level: Int) {
    }

    fun onConfigurationChanged() {
        systemTheme.update()
    }

    fun init() {
        initCrashTracking()
    }

    private fun initCrashTracking() {
        CrashTrackingHolder.initialize(CrashTrackingLocal())
    }
}
