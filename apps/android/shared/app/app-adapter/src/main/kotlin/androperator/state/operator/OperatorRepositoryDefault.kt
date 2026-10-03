package androperator.state.operator

import action.coroutine.flow.combineDistinct
import action.devicepackage.DevicePackageRepository
import action.system.window.WindowFrameManager
import androperator.data.trigger.Route
import androperator.data.trigger.RouteDeviceApp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

class OperatorRepositoryDefault(
    windowFrameManager: WindowFrameManager,
    private val devicePackageRepository: DevicePackageRepository,
    coroutineScopeMain: CoroutineScope,
    private val coroutineScopeIo: CoroutineScope,
) : OperatorRepository {
    private val isUiReady: StateFlow<Boolean> = windowFrameManager.isReady

    private val deviceApps: StateFlow<List<Route>?> by lazy {
        devicePackageRepository.allUserFacingDeviceApps
            .map { allDeviceApps -> allDeviceApps?.map { RouteDeviceApp(it) } }
            .stateIn(coroutineScopeIo, started = SharingStarted.Eagerly, initialValue = null)
    }

    override val isReady: StateFlow<Boolean> =
        combineDistinct(
            isUiReady,
            deviceApps,
        ) { isUiReady, deviceApps ->
            isUiReady && !deviceApps.isNullOrEmpty()
        }.stateIn(coroutineScopeMain, started = SharingStarted.Eagerly, initialValue = false)
}
