package androperator.di.module

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
import androperator.accessibilityservice.AccessibilityServiceManager
import androperator.accessibilityservice.AccessibilityServiceManagerAndroid
import androperator.app.AppStateManager
import androperator.app.AppStateManagerWrapper
import androperator.app.AppViewModel
import androperator.app.close.AppCloseManager
import androperator.app.close.AppCloseManagerAndroid
import androperator.appnotifications.AppNotificationsManager
import androperator.appnotifications.AppNotificationsManagerDefault
import androperator.apps.AppsRepository
import androperator.apps.AppsRepositoryDefault
import androperator.apps.KnownAppsRepository
import androperator.apps.KnownAppsRepositoryDefault
import androperator.apps.uninstall.UninstallAppManager
import androperator.apps.uninstall.UninstallAppManagerAndroid
import androperator.appstate.AppState
import androperator.appstate.AppStateMainProcess
import androperator.application.ApplicationLifecycleObserver
import androperator.defaults.apps.DefaultAppsRepository
import androperator.defaults.apps.DefaultAppsRepositoryDefault
import androperator.di.Factory
import androperator.di.FactoryAndroid
import androperator.di.NamedScope
import androperator.di.PlatformInjectionFactory
import androperator.di.getLazy
import androperator.openapp.OpenAppManager
import androperator.openapp.OpenAppManagerAndroid
import androperator.operator.OperatorDeviceIdProvider
import androperator.operator.OperatorDeviceIdProviderAndroid
import androperator.operator.agent.AgentCommandExecutor
import androperator.operator.agent.AgentCommandExecutorDefault
import androperator.operator.agent.AgentCommandParser
import androperator.operator.agent.AgentCommandParserDefault
import androperator.operator.foreground.ForegroundApplicationObserver
import androperator.operator.foreground.ForegroundApplicationReader
import androperator.operator.onscreenlog.OnScreenLogPanelController
import androperator.operator.onscreenlog.OnScreenLogPanelLifecycle
import androperator.operator.recording.RecordingEventFilter
import androperator.operator.recording.RecordingEventFilterDefault
import androperator.operator.recording.RecordingEventSink
import androperator.operator.recording.RecordingManagerDefault
import androperator.operator.command.OperatorCommandExecutor
import androperator.operator.command.OperatorCommandExecutorDefault
import androperator.operator.command.OperatorCommandParser
import androperator.operator.command.OperatorCommandParserDefault
import androperator.operator.command.OperatorCommandStatusReporter
import androperator.operator.command.OperatorCommandStatusReporterDefault
import androperator.operator.task.TaskStatusReporter
import androperator.operator.task.TaskStatusReporterDefault
import androperator.preferences.PreferenceDefaultsProviderDefault
import androperator.prefs.DevicePreferenceStorage
import androperator.prefs.DevicePreferenceStorageDefault
import androperator.prefs.PreferenceDefaults
import androperator.prefs.PreferenceDefaultsProvider
import androperator.prefs.PreferenceStorage
import androperator.prefs.PreferenceStorageDefault
import androperator.resources.string.Strings
import androperator.routine.RoutineFactory
import androperator.routine.RoutineFactoryDefault
import androperator.routine.RoutineManager
import androperator.routine.RoutineManagerDefault
import androperator.state.operator.OperatorRepository
import androperator.state.operator.OperatorRepositoryDefault
import androperator.state.operator.OperatorViewModel
import androperator.system.accessibility.SystemAccessibilityServiceManagerAndroid
import androperator.task.runner.TaskRunner
import androperator.task.runner.TaskRunnerDefault
import androperator.task.runner.TaskRunnerManager
import androperator.task.runner.TaskRunnerManagerDefault
import androperator.task.runner.TaskScope
import androperator.task.runner.TaskScopeDefault
import androperator.task.runner.TaskUiScope
import androperator.task.runner.TaskUiScopeDefault
import androperator.task.runner.RecordingManager
import androperator.task.runner.UiActionEngine
import androperator.task.runner.ApiToastController
import androperator.operator.toast.ApiToastControllerAndroid
import androperator.task.runner.UiActionEngineDefault
import androperator.task.runner.UiGlobalActionDispatcher
import androperator.task.runner.UiGlobalActionDispatcherAndroid
import androperator.task.runner.OnScreenLogController
import androperator.trigger.TriggerManager
import androperator.trigger.TriggerManagerDefault
import androperator.uitree.UiTreeFilterer
import androperator.uitree.UiTreeFiltererDefault
import androperator.uitree.UiTreeFormatter
import androperator.uitree.UiTreeFormatterDefault
import androperator.uitree.UiTreeInspector
import androperator.uitree.UiTreeInspectorAndroid
import androperator.uitree.UiTreeManager
import androperator.uitree.UiTreeManagerAndroid
import androperator.uitree.OperatorOverlayIdentity
import androperator.urlnavigator.UrlNavigator
import androperator.urlnavigator.UrlNavigatorAndroid
import androperator.workflow.WorkflowFactory
import androperator.workflow.WorkflowFactoryDefault
import androperator.workflow.WorkflowManager
import androperator.workflow.WorkflowManagerDefault
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
    single<BuildConfig> { FactoryAndroid.createBuildConfig(get(), androperator.di.BuildConfig.DEBUG) }
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

    single<androperator.application.Application> { androperator.application.ApplicationAndroid() }
}
