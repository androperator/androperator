package androperator.test

import action.appvisibility.AppVisibility
import action.appvisibility.AppVisibilityNoOp
import action.buildconfig.BuildConfig
import action.buildconfig.BuildConfigMock
import action.device.DeviceCountry
import action.device.DeviceCountryMock
import action.devicepackage.DeviceDefaultAppsRepository
import action.devicepackage.DeviceDefaultAppsRepositoryNoOp
import action.devicepackage.DevicePackageRepository
import action.devicepackage.DevicePackageRepositoryPreset
import action.devicepackage.PackageInfoRepository
import action.devicepackage.PackageInfoRepositoryPreset
import action.devicepackage.defaultapps.launcher.DefaultLauncherManager
import action.devicepackage.defaultapps.launcher.DefaultLauncherManagerNoOp
import action.language.LocaleRepository
import action.language.LocaleRepositoryMock
import action.network.NetworkState
import action.network.NetworkStatePreset
import action.notification.NotificationListenerConfig
import action.notification.NotificationListenerConfigPreset
import action.notification.NotificationListenerServiceManager
import action.notification.NotificationListenerServiceManagerNoOp
import action.system.action.SystemActionManager
import action.system.action.SystemActionManagerNoOp
import action.system.navigation.SystemNavigator
import action.system.navigation.SystemNavigatorNoOp
import action.system.toast.ToastDisplayController
import action.system.toast.ToastDisplayControllerNoOp
import action.system.unit.SystemUnitManager
import action.system.unit.SystemUnitManagerMock
import action.system.window.WindowFrameManager
import action.system.window.WindowFrameManagerNoOp
import action.telephony.TelephonyManager
import action.telephony.TelephonyManagerMock
import action.theme.SystemTheme
import action.theme.SystemThemeNoOp
import action.time.TimeRepository
import action.time.TimeRepositoryMock
import androperator.apps.uninstall.UninstallAppManager
import androperator.apps.uninstall.UninstallAppManagerNoOp
import androperator.openapp.OpenAppManager
import androperator.openapp.OpenAppManagerNoOp
import org.koin.core.module.Module
import org.koin.dsl.module

val ActionTestModule: Module =
    module {
        single<AppVisibility> { AppVisibilityNoOp() }
        single<BuildConfig> { BuildConfigMock() }
        single<DefaultLauncherManager> { DefaultLauncherManagerNoOp() }
        single<DeviceCountry> { DeviceCountryMock() }
        single<DeviceDefaultAppsRepository> { DeviceDefaultAppsRepositoryNoOp() }
        single<DevicePackageRepository> { DevicePackageRepositoryPreset() }
        single<LocaleRepository> { LocaleRepositoryMock() }
        single<NetworkState> { NetworkStatePreset() }
        single<NotificationListenerConfig> { NotificationListenerConfigPreset() }
        single<NotificationListenerServiceManager> { NotificationListenerServiceManagerNoOp() }
        single<OpenAppManager> { OpenAppManagerNoOp() }
        single<PackageInfoRepository> { PackageInfoRepositoryPreset() }
        single<SystemActionManager> { SystemActionManagerNoOp() }
        single<SystemNavigator> { SystemNavigatorNoOp() }
        single<SystemTheme> { SystemThemeNoOp() }
        single<SystemUnitManager> { SystemUnitManagerMock() }
        single<TelephonyManager> { TelephonyManagerMock() }
        single<TimeRepository> { TimeRepositoryMock() }
        single<ToastDisplayController> { ToastDisplayControllerNoOp }
        single<UninstallAppManager> { UninstallAppManagerNoOp() }
        single<WindowFrameManager> { WindowFrameManagerNoOp }
    }
