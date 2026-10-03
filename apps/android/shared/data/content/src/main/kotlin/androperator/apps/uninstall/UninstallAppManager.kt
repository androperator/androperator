package androperator.apps.uninstall

import action.coroutine.flow.combineDistinct
import action.devicepackage.DevicePackageRepository
import action.devicepackage.PackageInfoRepository
import action.system.model.ApplicationId
import action.system.ui.controller.UiControllerManager
import action.system.ui.controller.currentActivity
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.channelFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.yield

interface UninstallAppManager {
    fun canUninstallApp(applicationId: ApplicationId): Flow<Boolean>

    fun uninstallApp(applicationId: ApplicationId): Flow<UninstallAppState>
}

class UninstallAppManagerAndroid(
    private val context: Context,
    private val uiControllerManager: UiControllerManager,
    private val devicePackageRepository: DevicePackageRepository,
    private val packageInfoRepository: PackageInfoRepository,
) : UninstallAppManager {
    val isDesktopLocked: Flow<Boolean> = flowOf(false)

    private val activity: Activity?
        get() = uiControllerManager.currentActivity

    override fun canUninstallApp(applicationId: ApplicationId): Flow<Boolean> =
        combineDistinct(
            isDesktopLocked,
            devicePackageRepository.allUserFacingDeviceApps,
        ) { isDesktopLocked, allDeviceApps ->
            if (isDesktopLocked) {
                false
            } else {
                allDeviceApps
                    ?.firstOrNull { it.applicationId == applicationId }
                    ?.canBeUninstalled == true
            }
        }

    override fun uninstallApp(applicationId: ApplicationId): Flow<UninstallAppState> =
        channelFlow {
            send(UninstallAppState.Pending)

            val observer =
                object : DefaultLifecycleObserver {
                    // onResume is called immediately upon being added as an observer below, when the app is in the
                    // foreground. We don't want to check uninstall status at that time, so we track if it has been resumed once.
                    private var resumedOnce = false

                    override fun onResume(owner: LifecycleOwner) {
                        if (!resumedOnce) {
                            resumedOnce = true
                            return
                        }

                        val isUninstalled =
                            try {
                                context.packageManager.getPackageInfo(applicationId, 0)
                                false
                            } catch (_: PackageManager.NameNotFoundException) {
                                true
                            }

                        val uninstallState =
                            if (isUninstalled) {
                                UninstallAppState.Uninstalled
                            } else {
                                UninstallAppState.NotUninstalled
                            }

                        trySend(uninstallState)
                        close()
                    }
                }

            val lifecycleOwner =
                activity as? LifecycleOwner
                    ?: error("Context is not a LifecycleOwner")

            lifecycleOwner.lifecycle.addObserver(observer)

            // Post intent on next loop to ensure observer is in place before uninstall dialog
            launch {
                yield() // yield to event loop
                packageInfoRepository.showUninstallAppUi(applicationId)
            }

            awaitClose {
                lifecycleOwner.lifecycle.removeObserver(observer)
            }
        }
}
