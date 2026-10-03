package clawperator.di.module

import action.activity.StartActivityHelper
import action.apprestarter.AppRestarter
import action.apprestarter.AppRestarterDefault
import action.apprestarter.AppRestarterNoOp
import action.appvisibility.AppVisibility
import action.appvisibility.AppVisibilityDefaultProcess
import action.battery.BatteryManager
import action.battery.BatteryManagerSystem
import action.buildconfig.BuildConfig
import action.coroutine.CoroutineContextProvider
import action.coroutine.CoroutineScopes
import action.developeroptions.DeveloperOptionsManager
import action.developeroptions.DeveloperOptionsManagerAndroid
import action.device.DeviceCountry
import action.device.DeviceCountryDefault
import action.device.DeviceId
import action.device.DeviceIdSystem
import action.device.DeviceModel
import action.device.memory.DeviceMemory
import action.device.memory.DeviceMemorySystem
import action.devicepackage.DeviceDefaultAppsRepository
import action.devicepackage.DeviceDefaultAppsRepositoryAndroid
import action.devicepackage.DevicePackageRepository
import action.devicepackage.DevicePackageRepositoryAndroid
import action.devicepackage.PackageInfoRepository
import action.devicepackage.PackageInfoRepositorySystem
import action.devicepackage.PackageRepository
import action.devicepackage.PackageRepositoryConfig
import action.devicepackage.PackageRepositoryConfigDefault
import action.devicepackage.PackageRepositorySystem
import action.devicepackage.defaultapps.launcher.DefaultLauncherManager
import action.devicepackage.defaultapps.launcher.DefaultLauncherManagerAndroid
import action.devicepackage.installstate.PackageInstallStateReceiver
import action.devicepackage.installstate.PackageInstallStateReceiverSystem
import action.devicerefreshrate.DeviceRefreshRate
import action.devicerefreshrate.DeviceRefreshRateSystem
import action.devicestate.DeviceState
import action.devicestate.DeviceStateSystem
import action.di.Lazy
import action.environment.Environment
import action.environment.EnvironmentSystem
import action.graphics.color.ColorManager
import action.icon.IconResolver
import action.keyguard.KeyguardManager
import action.keyguard.KeyguardManagerSystem
import action.language.LocaleRepository
import action.language.LocaleRepositorySystem
import action.network.NetworkState
import action.notification.NotificationListenerConfig
import action.notification.NotificationListenerConfigAndroid
import action.notification.NotificationListenerServiceManager
import action.notification.NotificationListenerServiceManagerAndroid
import action.power.PowerManager
import action.power.PowerManagerSystem
import action.preferences.SharedPreferencesUpgrader
import action.preferences.SharedPreferencesUpgraderNoOp
import action.random.RandomManager
import action.random.RandomManagerDefault
import action.resources.string.DateTimeFormatter
import action.resources.string.DateTimeFormatterDefault
import action.resources.string.StringRepository
import action.resources.string.StringRepositoryDefault
import action.settings.AllSettings
import action.settings.SettingManager
import action.settings.SettingManagerDefault
import action.settings.Settings
import action.system.accessibility.SystemAccessibilityServiceManager
import action.system.action.SystemActionManager
import action.system.action.SystemActionManagerAndroid
import action.system.navigation.SystemNavigator
import action.system.navigation.SystemNavigatorAndroid
import action.system.platform.PlatformContext
import action.system.platform.PlatformContextAndroid
import action.system.settings.SystemSettingsRepository
import action.system.settings.SystemSettingsRepositorySystem
import action.system.toast.ToastDisplayController
import action.system.toast.ToastDisplayControllerDefault
import action.system.ui.controller.UiControllerManager
import action.system.ui.controller.UiControllerManagerAndroid
import action.system.ui.mode.UiModeManager
import action.system.ui.mode.UiModeManagerSystem
import action.system.unit.SystemUnitManager
import action.system.unit.SystemUnitManagerAndroid
import action.system.window.WindowFrameManager
import action.system.window.WindowFrameManagerAndroid
import action.system.window.WindowManagerDefault
import action.telephony.TelephonyManager
import action.telephony.TelephonyManagerSystem
import action.theme.SystemTheme
import action.theme.SystemThemeDefault
import action.time.TimeRepository
import action.time.TimeRepositorySystem
import android.content.SharedPreferences
import android.view.WindowManager as AndroidWindowManager
import androidx.core.app.NotificationManagerCompat
import clawperator.accessibilityservice.AccessibilityServiceManager
import clawperator.accessibilityservice.AccessibilityServiceManagerAndroid
import clawperator.app.AppStateManager
import clawperator.app.AppStateManagerWrapper
import clawperator.app.AppViewModel
import clawperator.app.close.AppCloseManager
import clawperator.app.close.AppCloseManagerAndroid
import clawperator.appnotifications.AppNotificationsManager
import clawperator.appnotifications.AppNotificationsManagerDefault
import clawperator.apps.AppsRepository
import clawperator.apps.AppsRepositoryDefault
import clawperator.apps.KnownAppsRepository
import clawperator.apps.KnownAppsRepositoryDefault
import clawperator.apps.uninstall.UninstallAppManager
import clawperator.apps.uninstall.UninstallAppManagerAndroid
import clawperator.appstate.AppState
import clawperator.appstate.AppStateMainProcess
import clawperator.application.ApplicationLifecycleObserver
import clawperator.defaults.apps.DefaultAppsRepository
import clawperator.defaults.apps.DefaultAppsRepositoryDefault
import clawperator.di.Factory
import clawperator.di.FactoryAndroid
import clawperator.di.NamedScope
import clawperator.di.PlatformInjectionFactory
import clawperator.di.getLazy
import clawperator.openapp.OpenAppManager
import clawperator.openapp.OpenAppManagerAndroid
import clawperator.operator.OperatorDeviceIdProvider
import clawperator.operator.OperatorDeviceIdProviderAndroid
import clawperator.operator.agent.AgentCommandExecutor
import clawperator.operator.agent.AgentCommandExecutorDefault
import clawperator.operator.agent.AgentCommandParser
import clawperator.operator.agent.AgentCommandParserDefault
import clawperator.operator.foreground.ForegroundApplicationObserver
import clawperator.operator.foreground.ForegroundApplicationReader
import clawperator.operator.onscreenlog.OnScreenLogPanelController
import clawperator.operator.onscreenlog.OnScreenLogPanelLifecycle
import clawperator.operator.recording.RecordingEventFilter
import clawperator.operator.recording.RecordingEventFilterDefault
import clawperator.operator.recording.RecordingEventSink
import clawperator.operator.recording.RecordingManagerDefault
import clawperator.operator.command.OperatorCommandExecutor
import clawperator.operator.command.OperatorCommandExecutorDefault
import clawperator.operator.command.OperatorCommandParser
import clawperator.operator.command.OperatorCommandParserDefault
import clawperator.operator.command.OperatorCommandStatusReporter
import clawperator.operator.command.OperatorCommandStatusReporterDefault
import clawperator.operator.task.TaskStatusReporter
import clawperator.operator.task.TaskStatusReporterDefault
import clawperator.preferences.PreferenceDefaultsProviderDefault
import clawperator.prefs.DevicePreferenceStorage
import clawperator.prefs.DevicePreferenceStorageDefault
import clawperator.prefs.PreferenceDefaults
import clawperator.prefs.PreferenceDefaultsProvider
import clawperator.prefs.PreferenceStorage
import clawperator.prefs.PreferenceStorageDefault
import clawperator.resources.string.Strings
import clawperator.routine.RoutineFactory
import clawperator.routine.RoutineFactoryDefault
import clawperator.routine.RoutineManager
import clawperator.routine.RoutineManagerDefault
import clawperator.state.operator.OperatorRepository
import clawperator.state.operator.OperatorRepositoryDefault
import clawperator.state.operator.OperatorViewModel
import clawperator.system.accessibility.SystemAccessibilityServiceManagerAndroid
import clawperator.task.runner.TaskRunner
import clawperator.task.runner.TaskRunnerDefault
import clawperator.task.runner.TaskRunnerManager
import clawperator.task.runner.TaskRunnerManagerDefault
import clawperator.task.runner.TaskScope
import clawperator.task.runner.TaskScopeDefault
import clawperator.task.runner.TaskUiScope
import clawperator.task.runner.TaskUiScopeDefault
import clawperator.task.runner.RecordingManager
import clawperator.task.runner.UiActionEngine
import clawperator.task.runner.ApiToastController
import clawperator.operator.toast.ApiToastControllerAndroid
import clawperator.task.runner.UiActionEngineDefault
import clawperator.task.runner.UiGlobalActionDispatcher
import clawperator.task.runner.UiGlobalActionDispatcherAndroid
import clawperator.task.runner.OnScreenLogController
import clawperator.trigger.TriggerManager
import clawperator.trigger.TriggerManagerDefault
import clawperator.uitree.UiTreeFilterer
import clawperator.uitree.UiTreeFiltererDefault
import clawperator.uitree.UiTreeFormatter
import clawperator.uitree.UiTreeFormatterDefault
import clawperator.uitree.UiTreeInspector
import clawperator.uitree.UiTreeInspectorAndroid
import clawperator.uitree.UiTreeManager
import clawperator.uitree.UiTreeManagerAndroid
import clawperator.uitree.OperatorOverlayIdentity
import clawperator.urlnavigator.UrlNavigator
import clawperator.urlnavigator.UrlNavigatorAndroid
import clawperator.workflow.WorkflowFactory
import clawperator.workflow.WorkflowFactoryDefault
import clawperator.workflow.WorkflowManager
import clawperator.workflow.WorkflowManagerDefault
import io.ktor.client.HttpClient
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import kotlinx.coroutines.CoroutineScope
import okhttp3.OkHttpClient
import org.koin.core.module.Module
import org.koin.dsl.module

@Suppress("RemoveExplicitTypeArguments")
val AppModule: Module = module {
    single<AllSettings> { Factory.allSettings(this) }
    single<AppNotificationsManager> { get<AppNotificationsManagerDefault>() }
    single<AppNotificationsManagerDefault> { AppNotificationsManagerDefault(get(), get()) }
    single<AppState> { Factory.appState(this) }
    single<AppStateMainProcess> { AppStateMainProcess(get(), get()) }
    single<AppStateManager> { AppStateManagerWrapper(get()) }
    single<OperatorViewModel> { OperatorViewModel(get(), get(), get(), get(), get(NamedScope.CoroutineScopeMain)) }
    single<AppViewModel> { AppViewModel(get(), get(), get(NamedScope.CoroutineScopeMain)) }
    single<AppVisibilityDefaultProcess> { AppVisibilityDefaultProcess() }
    single<AppsRepository> { AppsRepositoryDefault(get(), get(), get()) }
    single<ColorManager> { Factory.colorManager() }
    single<CoroutineContextProvider> { Factory.coroutineContextProvider(this) }
    single<CoroutineScope>(NamedScope.CoroutineScopeIo) { Factory.coroutineScopeIo(this) }
    single<CoroutineScope>(NamedScope.CoroutineScopeMain) { Factory.coroutineScopeMain(this) }
    single<CoroutineScopes> { Factory.coroutineScopes(this) }
    single<DateTimeFormatter> { DateTimeFormatterDefault(get()) }
    single<DefaultAppsRepository> { DefaultAppsRepositoryDefault(get(), get(NamedScope.CoroutineScopeIo)) }
    single<DeviceCountry> { DeviceCountryDefault(get(), get()) }
    single<DeviceModel> { Factory.deviceModel() }
    single<DevicePreferenceStorage> { get<DevicePreferenceStorageDefault>() }
    single<DevicePreferenceStorageDefault> { DevicePreferenceStorageDefault(get(), get(NamedScope.DeviceSettings), get(NamedScope.CoroutineScopeMain)) }
    single<DeviceRefreshRate> { get<DeviceRefreshRateSystem>() }
    single<DeviceRefreshRateSystem> { DeviceRefreshRateSystem(get()) }
    single<DeviceState> { get<DeviceStateSystem>() }
    single<DeviceStateSystem> { DeviceStateSystem(get(), get(), get()) }
    single<HttpClient> { Factory.httpClient(this) }
    single<KnownAppsRepository> { get<KnownAppsRepositoryDefault>() }
    single<KnownAppsRepositoryDefault> { KnownAppsRepositoryDefault() }
    single<Lazy<AppState>>(NamedScope.LazyAppState) { getLazy() }
    single<Lazy<AppStateMainProcess>>(NamedScope.LazyAppStateMainProcess) { getLazy() }
    single<Lazy<AppViewModel>>(NamedScope.LazyAppViewModel) { getLazy() }
    single<Lazy<AppVisibilityDefaultProcess>>(NamedScope.LazyAppVisibilityDefaultProcess) { getLazy() }
    single<Lazy<PreferenceStorage>>(NamedScope.LazyPreferenceStorage) { getLazy() }
    single<Lazy<SystemActionManager>>(NamedScope.LazySystemActionManager) { getLazy() }
    single<Lazy<TriggerManager>>(NamedScope.LazyTriggerManager) { getLazy() }
    single<NetworkState> { Factory.networkState(this) }
    single<OperatorCommandExecutor> { OperatorCommandExecutorDefault(get(), get(), get(), get(), get(), get(), get()) }
    single<OperatorCommandParser> { OperatorCommandParserDefault() }
    single<OperatorCommandStatusReporter> { OperatorCommandStatusReporterDefault(get()) }
    single<AgentCommandParser> { AgentCommandParserDefault() }
    single<AgentCommandExecutor> { AgentCommandExecutorDefault(get(), get()) }
    single<OnScreenLogPanelController> { OnScreenLogPanelController { get<ForegroundApplicationObserver>() } }
    single<OnScreenLogController> { get<OnScreenLogPanelController>() }
    single<OnScreenLogPanelLifecycle> { get<OnScreenLogPanelController>() }
    single<OperatorOverlayIdentity> { get<OnScreenLogPanelController>() }
    single { ForegroundApplicationReader(get()) }
    single { ForegroundApplicationObserver(get()) }
    single<RecordingManagerDefault> { RecordingManagerDefault(get(), get()) }
    single<RecordingManager> { get<RecordingManagerDefault>() }
    single<RecordingEventSink> { get<RecordingManagerDefault>() }
    single<RecordingEventFilter> { RecordingEventFilterDefault(get(), get()) }
    single<OperatorRepository> { get<OperatorRepositoryDefault>() }
    single<OperatorRepositoryDefault> { OperatorRepositoryDefault(get(), get(), get(NamedScope.CoroutineScopeMain), get(NamedScope.CoroutineScopeIo)) }
    single<PreferenceDefaults> { PreferenceDefaults(get()) }
    single<PreferenceDefaultsProvider> { PreferenceDefaultsProviderDefault(get(), true, get(), get(), get()) }
    single<PreferenceDefaultsProviderDefault> { PreferenceDefaultsProviderDefault(get(), true, get(), get(), get()) }
    single<PreferenceStorage> { PreferenceStorageDefault(get(), get(NamedScope.UserSettings), get(NamedScope.CoroutineScopeMain)) }
    single<RandomManager> { RandomManagerDefault() }
    single<RoutineFactory> { RoutineFactoryDefault(get(), get()) }
    single<RoutineManager> { RoutineManagerDefault(get(NamedScope.CoroutineScopeIo)) }
    single<SettingManager> { SettingManagerDefault(get(), get(NamedScope.CoroutineScopeMain)) }
    single<Settings>(NamedScope.DeviceSettings) { Factory.deviceSettings(this) }
    single<Settings>(NamedScope.UserSettings) { Factory.userSettings(this) }
    single<StringRepository> { StringRepositoryDefault(get(), get()) }
    single<Strings> { get<StringRepository>() }
    single<TaskRunner> { get<TaskRunnerDefault>() }
    single<TaskRunnerDefault> { TaskRunnerDefault(get(), get(NamedScope.CoroutineScopeMain)) }
    single<TaskRunnerManager> { get<TaskRunnerManagerDefault>() }
    single<TaskRunnerManagerDefault> { TaskRunnerManagerDefault(get(), get(), get(NamedScope.CoroutineScopeMain)) }
    single<TaskScope> { get<TaskScopeDefault>() }
    single<TaskScopeDefault> { TaskScopeDefault(get(), get(), get(), get(), get(), get(), get(), get(), get(NamedScope.CoroutineScopeIo)) }
    single<TaskStatusReporter> { get<TaskStatusReporterDefault>() }
    single<TaskStatusReporterDefault> { TaskStatusReporterDefault() }
    single<TaskUiScope> { get<TaskUiScopeDefault>() }
    single<TaskUiScopeDefault> { TaskUiScopeDefault(get(), get(), get(), get(), get(NamedScope.CoroutineScopeIo)) }
    single<UiActionEngine> { get<UiActionEngineDefault>() }
    single<ApiToastController> { ApiToastControllerAndroid(get()) }
    single<UiActionEngineDefault> { UiActionEngineDefault(get(), get(), get(), get(), get(), action.media.NotificationMediaService(get()), get()) }
    single<UiGlobalActionDispatcher> { get<UiGlobalActionDispatcherAndroid>() }
    single<UiGlobalActionDispatcherAndroid> { UiGlobalActionDispatcherAndroid(get()) }
    single<TriggerManager> { TriggerManagerDefault(get(), get(), get(), get(), get(), get(NamedScope.CoroutineScopeMain), get(NamedScope.CoroutineScopeIo)) }
    single<action.system.window.WindowManager> { WindowManagerDefault(get()) }
    single<WorkflowFactory> { get<WorkflowFactoryDefault>() }
    single<WorkflowFactoryDefault> { WorkflowFactoryDefault(get(), get()) }
    single<WorkflowManager> { get<WorkflowManagerDefault>() }
    single<WorkflowManagerDefault> { WorkflowManagerDefault(get(), get()) }

    // Folded from AppPlatformModule and PlatformModule
    single<AppCloseManager> { get<AppCloseManagerAndroid>() }
    single<AppCloseManagerAndroid> { AppCloseManagerAndroid(get(), get(), get(), get()) }
    single<AppRestarter> { get<AppRestarterDefault>() }
    single<AppRestarterDefault> { AppRestarterDefault(get(), get()) }
    single<AppRestarterNoOp> { AppRestarterNoOp }
    single<ApplicationLifecycleObserver> { ApplicationLifecycleObserver(get(), get(NamedScope.LazyTimeRepository)) }
    single<BuildConfig> { FactoryAndroid.createBuildConfig(get(), clawperator.di.BuildConfig.DEBUG) }
    single<DeviceId> { get<DeviceIdSystem>() }
    single<DeviceIdSystem> { DeviceIdSystem(get()) }
    single<DeviceMemory> { get<DeviceMemorySystem>() }
    single<DeviceMemorySystem> { DeviceMemorySystem(get()) }
    single<DefaultLauncherManager> { get<DefaultLauncherManagerAndroid>() }
    single<DefaultLauncherManagerAndroid> { DefaultLauncherManagerAndroid(get(), get(), get(), get(), get(NamedScope.CoroutineScopeIo)) }
    single<IconResolver> { IconResolver(get()) }
    single<Lazy<DevicePreferenceStorage>>(NamedScope.LazyDevicePreferenceStorage) { getLazy() }
    single<Lazy<DeviceStateSystem>>(NamedScope.LazyDeviceStateSystem) { getLazy() }
    single<LocaleRepository> { get<LocaleRepositorySystem>() }
    single<LocaleRepositorySystem> { LocaleRepositorySystem(get()) }
    single<OkHttpClient> { FactoryAndroid.createOkHttpClient(this) }
    single<OpenAppManager> { get<OpenAppManagerAndroid>() }
    single<OpenAppManagerAndroid> { OpenAppManagerAndroid(get(), get(), get()) }
    single<OperatorDeviceIdProvider> { get<OperatorDeviceIdProviderAndroid>() }
    single<OperatorDeviceIdProviderAndroid> { OperatorDeviceIdProviderAndroid(get()) }
    single<SharedPreferences>(NamedScope.DeviceSharedPrefs) { FactoryAndroid.deviceSharedPrefs(this) }
    single<SharedPreferences>(NamedScope.UserSharedPrefs) { FactoryAndroid.userSharedPrefs(this) }
    single<SharedPreferencesUpgrader> { SharedPreferencesUpgraderNoOp() }
    single<StartActivityHelper> { StartActivityHelper(get(), get(), get()) }
    single<String>(NamedScope.ApplicationId) { FactoryAndroid.applicationId(this) }
    single<SystemTheme> { get<SystemThemeDefault>() }
    single<SystemThemeDefault> { SystemThemeDefault(get(), get()) }
    single<SystemUnitManager> { get<SystemUnitManagerAndroid>() }
    single<SystemUnitManagerAndroid> { SystemUnitManagerAndroid(get()) }
    single<ToastDisplayController> { get<ToastDisplayControllerDefault>() }
    single<ToastDisplayControllerDefault> { ToastDisplayControllerDefault(get(), get(NamedScope.CoroutineScopeMain)) }
    single<action.system.ui.mode.UiModeManager> { get<UiModeManagerSystem>() }
    single<UiModeManagerSystem> { UiModeManagerSystem(get()) }
    single<WindowFrameManager> { FactoryAndroid.windowFrameManager(this) }
    single<WindowFrameManagerAndroid>{ WindowFrameManagerAndroid(get(), get(), get()) }

    single<AppVisibility> { Factory.appVisibility(this) }
    single<android.content.res.AssetManager> { PlatformInjectionFactory.assetManager(get()) }
    single<AccessibilityServiceManager> { get<AccessibilityServiceManagerAndroid>() }
    single<AccessibilityServiceManagerAndroid> { AccessibilityServiceManagerAndroid() }
    single<DeveloperOptionsManager> { get<DeveloperOptionsManagerAndroid>() }
    single<DeveloperOptionsManagerAndroid> { DeveloperOptionsManagerAndroid(get()) }
    single<BatteryManager> { get<BatteryManagerSystem>() }
    single<BatteryManagerSystem> { BatteryManagerSystem(get()) }
    single<android.net.ConnectivityManager> { PlatformInjectionFactory.connectivityManager(get()) }
    single<DeviceDefaultAppsRepository> { get<DeviceDefaultAppsRepositoryAndroid>() }
    single<DeviceDefaultAppsRepositoryAndroid> { DeviceDefaultAppsRepositoryAndroid(get(), get(), get()) }
    single<DevicePackageRepository> { get<DevicePackageRepositoryAndroid>() }
    single<DevicePackageRepositoryAndroid> { DevicePackageRepositoryAndroid(get(), get(), get(), get(NamedScope.CoroutineScopeIo)) }
    single<Environment> { get<EnvironmentSystem>() }
    single<EnvironmentSystem> { EnvironmentSystem(get()) }
    single<Executor> { FactoryAndroid.executor() }
    single<ExecutorService> { FactoryAndroid.executorService() }
    single<android.app.job.JobScheduler> { PlatformInjectionFactory.jobsSchedulerService(get()) }
    single<KeyguardManager> { get<KeyguardManagerSystem>() }
    single<KeyguardManagerSystem> { KeyguardManagerSystem(get()) }
    single<android.content.pm.LauncherApps> { PlatformInjectionFactory.launcherApps(get()) }
    single<Lazy<TimeRepository>>(NamedScope.LazyTimeRepository) { getLazy() }
    single<NotificationListenerConfig> { get<NotificationListenerConfigAndroid>() }
    single<NotificationListenerConfigAndroid> { NotificationListenerConfigAndroid(get()) }
    single<NotificationListenerServiceManager> { get<NotificationListenerServiceManagerAndroid>() }
    single<NotificationListenerServiceManagerAndroid> { NotificationListenerServiceManagerAndroid(get()) }
    single<NotificationManagerCompat> { PlatformInjectionFactory.notificationManagerCompat(get()) }
    single<PackageInfoRepository> { get<PackageInfoRepositorySystem>() }
    single<PackageInfoRepositorySystem> { PackageInfoRepositorySystem(get()) }
    single<PackageInstallStateReceiver> { get<PackageInstallStateReceiverSystem>() }
    single<PackageInstallStateReceiverSystem> { PackageInstallStateReceiverSystem(get()) }
    single<android.content.pm.PackageManager> { PlatformInjectionFactory.packageManager(get()) }
    single<PackageRepository> { PackageRepositorySystem(get(), get(), get(), get(), get()) }
    single<PackageRepositoryConfig> { PackageRepositoryConfigDefault() }
    single<PlatformContext> { PlatformContextAndroid(get()) }
    single<PowerManager> { get<PowerManagerSystem>() }
    single<PowerManagerSystem> { PowerManagerSystem(get()) }
    single<android.hardware.SensorManager> { PlatformInjectionFactory.sensorManager(get()) }
    single<SystemAccessibilityServiceManager> { get<SystemAccessibilityServiceManagerAndroid>() }
    single<SystemAccessibilityServiceManagerAndroid> { SystemAccessibilityServiceManagerAndroid(get()) }
    single<SystemActionManager> { get<SystemActionManagerAndroid>() }
    single<SystemActionManagerAndroid> { SystemActionManagerAndroid(get(), get()) }
    single<SystemNavigator> { get<SystemNavigatorAndroid>() }
    single<SystemNavigatorAndroid> { SystemNavigatorAndroid(get(), get(), get(), get()) }
    single<SystemSettingsRepository> { get<SystemSettingsRepositorySystem>() }
    single<SystemSettingsRepositorySystem> { SystemSettingsRepositorySystem(get()) }
    single<action.telephony.TelephonyManager> { get<TelephonyManagerSystem>() }
    single<TelephonyManagerSystem> { TelephonyManagerSystem(get()) }
    single<TimeRepository> { get<TimeRepositorySystem>() }
    single<TimeRepositorySystem> { TimeRepositorySystem(get()) }
    single<UiControllerManager> { get(UiControllerManagerAndroid::class) }
    single<UiControllerManagerAndroid> { UiControllerManagerAndroid() }
    single<android.app.UiModeManager> { PlatformInjectionFactory.uiModeManager(get()) }
    single<UiTreeFilterer> { get<UiTreeFiltererDefault>() }
    single<UiTreeFiltererDefault> { UiTreeFiltererDefault(get()) }
    single<UiTreeFormatter> { get<UiTreeFormatterDefault>() }
    single<UiTreeFormatterDefault> { UiTreeFormatterDefault() }
    single<UiTreeInspector> { get<UiTreeInspectorAndroid>() }
    single<UiTreeInspectorAndroid> { UiTreeInspectorAndroid(get(), get()) }
    single<UiTreeManager> { get<UiTreeManagerAndroid>() }
    single<UiTreeManagerAndroid> { UiTreeManagerAndroid(get()) }
    single<UninstallAppManager> { UninstallAppManagerAndroid(get(), get(), get(), get()) }
    single<UrlNavigator> { get<UrlNavigatorAndroid>() }
    single<UrlNavigatorAndroid> { UrlNavigatorAndroid(get(), get(), get())}
    single<android.os.UserManager> { PlatformInjectionFactory.userManager(get()) }
    single<AndroidWindowManager> { PlatformInjectionFactory.windowManager(get()) }

    single<clawperator.application.Application> { clawperator.application.ApplicationAndroid() }
}
